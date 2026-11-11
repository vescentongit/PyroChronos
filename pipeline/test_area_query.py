import tempfile
import unittest
from pathlib import Path

from area_query import GeometryError, Polygon, period_minutes, query
from detection_store import BlockBuilder, RowDecoder, decode, iter_tiles, month_path, read_header, tiles_for_bbox, write_month
from synthetic import MODIS_HEADER, modis_row


def poly(*rings, **options):
    return Polygon({"type": "Polygon", "coordinates": [[list(point) for point in ring] for ring in rings]}, **options)


SQUARE = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]
TRIANGLE = [(0, 0), (10, 0), (0, 10), (0, 0)]
HOLE = [(4, 4), (6, 4), (6, 6), (4, 6), (4, 4)]


def store_with(root, rows, month="2019-09", source="MODIS_SP"):
    decoder = RowDecoder(MODIS_HEADER.split(","), source)
    builder = BlockBuilder()
    for text in rows:
        m, tile, packed, _ = decoder.decode(text.split(","))
        builder.add(m, tile, packed)
    blocks, stats = builder.finalize_month(month)
    write_month(root, source, month, blocks, stats, "0" * 64)


class PolygonTests(unittest.TestCase):
    def test_triangle_differs_from_its_bbox(self):
        triangle = poly(TRIANGLE)
        self.assertTrue(triangle.contains(2, 2))
        self.assertFalse(triangle.contains(8, 8))
        self.assertTrue(poly(SQUARE).contains(8, 8))

    def test_hole_excludes_interior_and_edge_but_not_surroundings(self):
        donut = poly(SQUARE, HOLE)
        self.assertFalse(donut.contains(5, 5))
        self.assertFalse(donut.contains(4, 5))
        self.assertTrue(donut.contains(2, 2))
        self.assertTrue(donut.contains(0, 5))
        self.assertLess(donut.area_km2, poly(SQUARE).area_km2)

    def test_antimeridian_polygon_contains_both_sides(self):
        crossing = poly([(170, -10), (-170, -10), (-170, 10), (170, 10), (170, -10)])
        self.assertTrue(crossing.crosses_antimeridian)
        self.assertEqual(crossing.bbox_pieces(), [(170.0, -10.0, 180.0, 10.0), (-180.0, -10.0, -170.0, 10.0)])
        for lon in (175, 180, -180, -175):
            self.assertTrue(crossing.contains(lon, 0), lon)
        self.assertFalse(crossing.contains(0, 0))
        self.assertFalse(crossing.contains(-160, 0))
        self.assertEqual(crossing.geometry["coordinates"][0][1], [-170.0, -10.0])

    def test_antimeridian_hole(self):
        crossing = poly([(160, -20), (-160, -20), (-160, 20), (160, 20), (160, -20)], [(178, -5), (-178, -5), (-178, 5), (178, 5), (178, -5)])
        self.assertFalse(crossing.contains(179, 0))
        self.assertFalse(crossing.contains(-179, 0))
        self.assertTrue(crossing.contains(170, 0))
        self.assertTrue(crossing.contains(-170, 0))

    def test_small_area_polygon_is_valid(self):
        tiny = poly([(114.0, -2.0), (114.01, -2.0), (114.01, -1.99), (114.0, -1.99), (114.0, -2.0)])
        self.assertTrue(tiny.contains(114.005, -1.995))
        self.assertGreater(tiny.area_km2, 0.5)

    def test_area_is_close_to_known_value(self):
        self.assertAlmostEqual(poly([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]).area_km2, 12364.3, delta=5)

    def test_invalid_geometries_are_rejected(self):
        cases = {
            "unclosed": [(0, 0), (1, 0), (1, 1), (0, 1), (0, 0.5)],
            "bowtie": [(0, 0), (10, 10), (10, 0), (0, 10), (0, 0)],
            "collinear": [(0, 0), (1, 0), (2, 0), (3, 0), (0, 0)],
            "range": [(0, 0), (200, 0), (200, 10), (0, 10), (0, 0)],
        }
        for name, ring in cases.items():
            with self.assertRaises(GeometryError, msg=name):
                poly(ring)
        with self.assertRaises(GeometryError):
            poly(SQUARE, [(20, 20), (22, 20), (22, 22), (20, 22), (20, 20)])
        with self.assertRaises(GeometryError):
            poly(SQUARE, HOLE, [(5, 5), (5.5, 5), (5.5, 5.5), (5, 5.5), (5, 5)])
        with self.assertRaises(GeometryError):
            Polygon({"type": "MultiPolygon", "coordinates": []})
        with self.assertRaises(GeometryError):
            poly(SQUARE, max_vertices=3)
        with self.assertRaises(GeometryError):
            poly(SQUARE, max_area_km2=1000)

    def test_geometry_hash_is_stable(self):
        self.assertEqual(poly(SQUARE).geometry_hash(), poly(SQUARE).geometry_hash())
        self.assertNotEqual(poly(SQUARE).geometry_hash(), poly(TRIANGLE).geometry_hash())


class StoreAndQueryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_round_trip_dedupe_and_tile_read(self):
        row = modis_row(-2.4, 114.1, "2019-09-14", frp="")
        store_with(self.root, [row, row, modis_row(40, -100, "2019-09-14", satellite="Aqua")])
        path = month_path(self.root, "MODIS_SP", "2019-09")
        header, _ = read_header(path)
        self.assertEqual((header["count"], header["duplicates"]), (2, 1))
        records = list(iter_tiles(path, tiles_for_bbox(113, -3.6, 115, -1.5), 0, 10**9))
        self.assertEqual(len(records), 1)
        item = decode(records[0], "MODIS_SP")
        self.assertEqual((item["lat"], item["lon"], item["frpMw"], item["satellite"]), (-2.4, 114.1, None, "Terra"))
        self.assertEqual(item["observedAt"], "2019-09-14T03:00:00Z")

    def test_polygon_query_differs_from_bbox_and_respects_inclusive_utc_dates(self):
        rows = [
            modis_row(2, 2, "2019-09-14", "0000"),
            modis_row(8, 8, "2019-09-14", "2359"),
            modis_row(1, 3, "2019-09-15", "0000"),
            modis_row(1, 4, "2019-09-13", "2359"),
            modis_row(5, 5, "2019-09-14", "1200"),
        ]
        store_with(self.root, rows)
        found = list(query(self.root, "MODIS_SP", poly(TRIANGLE), "2019-09-14", "2019-09-14"))
        self.assertEqual([i["observedAt"][11:16] for i in found], ["00:00", "12:00"])
        self.assertEqual(len(list(query(self.root, "MODIS_SP", poly(SQUARE), "2019-09-14", "2019-09-14"))), 3)
        self.assertEqual(len(list(query(self.root, "MODIS_SP", poly(SQUARE), "2019-09-13", "2019-09-15"))), 5)
        first, last = period_minutes("2019-09-14", "2019-09-14")
        self.assertEqual(last - first, 1440)
        with self.assertRaises(ValueError):
            period_minutes("2019-09-15", "2019-09-14")

    def test_query_across_antimeridian_and_missing_months(self):
        store_with(self.root, [modis_row(0, 175, "2019-09-02"), modis_row(0, -175, "2019-09-03"), modis_row(0, 0, "2019-09-04")])
        crossing = poly([(170, -10), (-170, -10), (-170, 10), (170, 10), (170, -10)])
        self.assertEqual(len(list(query(self.root, "MODIS_SP", crossing, "2019-08-25", "2019-10-05"))), 2)


if __name__ == "__main__":
    unittest.main()
