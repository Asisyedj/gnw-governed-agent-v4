import type { FastifyPluginAsync } from "fastify";
import { GOVERNANCE_PIPELINE, GOVERNANCE_ROLES, ROLE_CAPABILITIES } from "../governance-contract.js";
import { JUSTICE_DIMENSIONS } from "../justice-framework.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const governanceRoutes: FastifyPluginAsync = async app => {
  app.get("/governance/contract", async (req, reply) => {
    const auth = await requireAuth(req, reply, app.db, "viewer");
    if (!auth) return;
    return reply.send({
      roles: GOVERNANCE_ROLES.map(role => ({ role, capabilities: ROLE_CAPABILITIES[role] })),
      pipeline: GOVERNANCE_PIPELINE, justiceDimensions: JUSTICE_DIMENSIONS,
      invariants: { leastPrivilege:true, unknownIsValid:true, derivativeReportsNotIndependent:true, normativeTextNotImplementationProof:true, symmetricEvidenceStandard:true, workerEvidenceDeletion:false, workerPermissionMutation:false, externalSideEffectsDefault:false },
    });
  });
};