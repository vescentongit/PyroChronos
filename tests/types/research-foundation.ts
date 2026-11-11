import type { AnalysisJob, AnalysisJobAttempt, AnalysisArtifact } from "@prisma/client";
import type {
  AnalysisJobRecord, AnalysisJobAttempt as AttemptContract, AnalysisArtifact as ArtifactContract,
  AnalysisPublication, MonitoringLocationRecord,
} from "../../src/lib/research-foundation-contracts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
// Compile-time regression checks: enum drift and accidental untyped JSON must fail typecheck.
export type FoundationTypeAssertions = [
  Assert<Equal<AnalysisJob["status"], AnalysisJobRecord["status"]>>,
  Assert<Equal<AnalysisJobAttempt["status"], AttemptContract["status"]>>,
  Assert<Equal<AnalysisArtifact["kind"], ArtifactContract["kind"]>>,
  Assert<Equal<AnalysisPublication["result"]["payload"]["method"]["unit"], "estimated-hotspot-detections">>,
  Assert<Equal<MonitoringLocationRecord["anchor"]["coordinates"], [number, number]>>,
];
