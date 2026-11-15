"""Synthetic archive builders for tests only. Data made here is fictional and never real FIRMS output."""

import zipfile

MODIS_HEADER = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type"
VIIRS_HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type"


def modis_row(lat, lon, day, time="0300", confidence=70, kind=0, frp="5", satellite="Terra"):
    return f"{lat},{lon},320,1,1,{day},{time},{satellite},MODIS,{confidence},6.1,295,{frp},D,{kind}"


def viirs_row(lat, lon, day, time="0545", confidence="n", kind=0, frp="12.5", satellite="N"):
    return f"{lat},{lon},330,0.4,0.4,{day},{time},{satellite},VIIRS,{confidence},2.0,290,{frp},D,{kind}"


def make_archive(path, files, header, year):
    with zipfile.ZipFile(path, "w") as archive:
        for name, rows in files.items():
            archive.writestr(f"synthetic/{year}/{name}.csv", "\n".join([header, *rows]) + "\n")
