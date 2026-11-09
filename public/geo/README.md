# Globe geography

`ne_110m_land.json`: Natural Earth land polygons, 1:110m scale, downloaded from [martynafford/natural-earth-geojson](https://github.com/martynafford/natural-earth-geojson/blob/master/110m/physical/ne_110m_land.json). Natural Earth data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/). Used for the decorative geographic globe, not for study-region boundaries or fire analysis.

`land-dots.json` is derived from that geometry by `node scripts/build-globe-land.mjs`. Precomputing the points avoids polygon containment work in the browser. Both assets are served locally; the Home page requires no third-party geographic request.

Fire markers come from the application's explicitly illustrative demo fixtures. They are not live FIRMS detections.
