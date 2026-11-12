import type { P1AnalysisJob, P1AnalysisJobAttempt, P1AnalysisArtifact } from "@prisma/client";
import type {
  P1AnalysisJobRecord, P1AnalysisJobAttempt as AttemptContract, P1AnalysisArtifact as ArtifactContract,
  AnalysisPublication, MonitoringLocationRecord,
} from "../../src/lib/research-foundation-contracts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
// Compile-time regression checks: enum drift and accidental untyped JSON must fail typecheck.
export type FoundationTypeAssertions = [
  Assert<Equal<P1AnalysisJob["status"], P1AnalysisJobRecord["status"]>>,
  Assert<Equal<P1AnalysisJobAttempt["status"], AttemptContract["status"]>>,
  Assert<Equal<P1AnalysisArtifact["kind"], ArtifactContract["kind"]>>,
  Assert<Equal<AnalysisPublication["result"]["payload"]["method"]["unit"], "estimated-hotspot-detections">>,
  Assert<Equal<MonitoringLocationRecord["anchor"]["coordinates"], [number, number]>>,
];
