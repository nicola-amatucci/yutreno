/*
 * Minimal test of the openETCS onboard computer: initialises the context, runs 500 cycles of 10 ms with empty
 * inputs and prints the computed mode, level and speed. It only checks that the generated code compiles and runs on
 * this machine; the adapter towards YuTreno is described in docs/EVC_GUIDE.md.
 */
#include <stdio.h>
#include <string.h>
#include "EVC.h"

static outC_EVC ctx;  /* about 2 MB: better static than on the stack */

int main(void) {
  odometry_T_Obu_BasicTypes_Pkg odo;
  API_TrackSideInput_T_API_Msg_Pk trk;
  DMI_to_EVC_Message_int_T_API_DM dmi;
  TIU_Input_msg_API_TIU_Pkg tiu;
  mobileHWStatus_Type_MoRC_Pck hw;
  ps_dataForStartOfMission_T_API_ ps;
  memset(&odo, 0, sizeof odo); memset(&trk, 0, sizeof trk); memset(&dmi, 0, sizeof dmi);
  memset(&tiu, 0, sizeof tiu); memset(&hw, 0, sizeof hw); memset(&ps, 0, sizeof ps);
  EVC_init(&ctx);
  odo.valid = 1;
  for (int k = 0; k < 500; k++) {
    odo.timestamp = k * 10;  /* ms */
    EVC(k == 0, &odo, k * 10, &trk, &dmi, &tiu, &hw, &ps, &ctx);
    if (k % 100 == 0)
      printf("cycle %3d: ready=%d mode=%d level=%d v_permitted=%.1f emergency=%d\n", k, ctx.EVC_ready,
             (int)ctx.debugCurrentMode, (int)ctx.debugCurrentLevel, ctx.debugPermittedSpeed,
             (int)ctx.API_toTIU.info.brake_command.m_emergencybrake_cm);
  }
  printf("EVC context: %zu bytes. Mode 16 = No Power: without an active cab the onboard stays off.\n", sizeof ctx);
  return 0;
}
