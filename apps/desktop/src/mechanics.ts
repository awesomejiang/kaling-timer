import { loadMechanics } from "@kaling/mechanics";
import source from "../../../config/mechanics.yaml?raw";
export const mechanics = loadMechanics(source);
