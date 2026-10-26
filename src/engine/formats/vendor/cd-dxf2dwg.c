#include "config.h"
#include <string.h>
#include "dwg.h"

/* Read a DXF and write a DWG. version is a LibreDWG token such as "r2000". */
int cd_dxf_to_dwg(const char *dxf_path, const char *dwg_path, const char *version) {
  Dwg_Data dwg;
  Dwg_Version_Type ver;
  int error;

  memset(&dwg, 0, sizeof dwg);
  ver = (version && version[0]) ? dwg_version_as(version) : R_2000;
  if (ver == R_INVALID || ver == R_2007 || (ver >= R_2007a && ver <= R_2007)) ver = R_2000;
  dwg.header.version = ver;
  error = dxf_read_file(dxf_path, &dwg);
  if (error >= DWG_ERR_CRITICAL) {
    dwg_free(&dwg);
    return error;
  }
  dwg.header.version = ver;
  if (dwg.header.from_version == R_INVALID) dwg.header.from_version = dwg.header.version;
  error = dwg_write_file(dwg_path, &dwg);
  dwg_free(&dwg);
  return error;
}
