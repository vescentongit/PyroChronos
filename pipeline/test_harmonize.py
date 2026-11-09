import unittest

from harmonize import fit, mae, transform


class CalibrationTests(unittest.TestCase):
    def setUp(self):
        self.model = fit([0, 1, 2, 3, 4, 5], [0, 2, 4, 6, 8, 10])

    def test_zero_and_support(self):
        self.assertEqual(transform(self.model, 0)["value"], 0)
        self.assertTrue(transform(self.model, 100)["outside_support"])

    def test_monotonic_mapping(self):
        values = [transform(self.model, value)["value"] for value in [0, 1, 2, 3, 4, 5]]
        self.assertEqual(values, sorted(values))
        self.assertEqual(mae(values, [0, 2, 4, 6, 8, 10]), 0)

    def test_invalid_training_rejected(self):
        invalid_pairs = [
            ([0] * 5, [0] * 5),
            ([1, 2], [1, 2]),
            ([1, 2, 3, 4, float("nan")], [1] * 5),
        ]

        for source, reference in invalid_pairs:
            with self.assertRaises(ValueError):
                fit(source, reference)


if __name__ == "__main__":
    unittest.main()
