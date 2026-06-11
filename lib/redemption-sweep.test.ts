// Tests for the owner-deletion staff-device sweep selection (audit Finding 6,
// batch R5). Lives under lib/ because supabase/functions is deno-checked per
// file; the module under test is pure.
import { describe, expect, it } from "vitest";
import { staffUserIdsToSweep } from "../supabase/functions/_shared/redemption-sweep";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STAFF_A = "22222222-2222-4222-8222-222222222222";
const STAFF_B = "33333333-3333-4333-8333-333333333333";

describe("staffUserIdsToSweep", () => {
  it("collects each linked staff user once", () => {
    const rows = [
      { staff_user_id: STAFF_A },
      { staff_user_id: STAFF_B },
      { staff_user_id: STAFF_A }, // re-activated device reuses its staff user
    ];
    expect(staffUserIdsToSweep(rows, OWNER).sort()).toEqual([STAFF_A, STAFF_B].sort());
  });

  it("skips removed devices (null staff_user_id) and malformed ids", () => {
    const rows = [
      { staff_user_id: null },
      {},
      { staff_user_id: "" },
      { staff_user_id: "not-a-uuid" },
      { staff_user_id: STAFF_A },
    ];
    expect(staffUserIdsToSweep(rows, OWNER)).toEqual([STAFF_A]);
  });

  it("never selects the owner's own id", () => {
    expect(staffUserIdsToSweep([{ staff_user_id: OWNER }], OWNER)).toEqual([]);
  });

  it("handles a failed or empty lookup without sweeping anything", () => {
    expect(staffUserIdsToSweep(null, OWNER)).toEqual([]);
    expect(staffUserIdsToSweep(undefined, OWNER)).toEqual([]);
    expect(staffUserIdsToSweep([], OWNER)).toEqual([]);
  });
});
