import * as db from "../database/db";
import { createRideRecorder } from "./rideRecorder";

/**
 * The app's one ride recorder, wired to the device database.
 *
 * A single instance rather than one per screen: background location arrives
 * with nothing mounted, and two recorders would each hold half a ride's
 * samples in their own buffer.
 *
 * `../database/db` resolves to `db.web.ts` on web and `db.ts` on a device, so
 * this is the only place either is named.
 */
export const rideRecorder = createRideRecorder(db);
