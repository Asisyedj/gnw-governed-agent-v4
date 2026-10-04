export const JUSTICE_DIMENSIONS = [
  "rule_bound_accessible","material_social","impartial_administration",
  "arbitrary_coercion_protection","voice_accountability_correction","equal_civic_standing_group_protection"
] as const;
export type JusticeDimension = typeof JUSTICE_DIMENSIONS[number];
export type JusticeFinding = { dimension:JusticeDimension; status:"pass"|"fail"|"insufficient_evidence"|"unknown"; evidenceRefs:string[]; rationale:string; correction?:string };
export type JusticeReview = { findings:JusticeFinding[]; complete:boolean; failures:JusticeDimension[] };
export function buildJusticeReview(findings:readonly JusticeFinding[]):JusticeReview{
  const byDimension=new Map(findings.map(f=>[f.dimension,f]));
  const complete=JUSTICE_DIMENSIONS.every(d=>byDimension.has(d));
  const failures=findings.filter(f=>f.status==="fail").map(f=>f.dimension);
  return {findings:[...findings],complete,failures};
}
export function assertJusticeReviewComplete(review:JusticeReview):void{
  if(!review.complete) throw new Error("justice_review_incomplete");
  if(review.failures.length) throw new Error("justice_review_failed:"+review.failures.join(","));
}
export function isJusticeDimension(value:string):value is JusticeDimension{
  return (JUSTICE_DIMENSIONS as readonly string[]).includes(value);
}