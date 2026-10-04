import { z } from "zod";

export const DecisionStatus = z.enum(["SUPPORTED","UNSUPPORTED","MIXED","UNKNOWN"]);
export const FinalDecisionSchema = z.object({
  status: DecisionStatus,
  findings: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  justiceReview: z.unknown(),
  uncertainties: z.array(z.string()).default([]),
  corrections: z.array(z.string()).default([]),
  auditId: z.string().min(1),
});
export type FinalDecision = z.infer<typeof FinalDecisionSchema>;

export function validateFinalDecision(value: unknown): FinalDecision {
  return FinalDecisionSchema.parse(value);
}