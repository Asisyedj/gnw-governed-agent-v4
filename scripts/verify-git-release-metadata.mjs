import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const fail=[];
const run=(args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
const isSha40=v=>/^[0-9a-f]{40}$/i.test(v??"");
const head=run(["rev-parse","HEAD"]);
const tree=run(["rev-parse","HEAD^{tree}"]);
const status=run(["status","--porcelain"]);
if(!isSha40(head))fail.push("HEAD is not a full SHA-1");
if(!/^[0-9a-f]{40}$/i.test(tree))fail.push("HEAD tree is not a full SHA-1");
if(status)fail.push("working tree is dirty");
try{run(["diff","--check"]);}catch{fail.push("git diff --check failed");}

const event=process.env.GITHUB_EVENT_NAME??"";
const workflowSha=(process.env.GITHUB_SHA??"").toLowerCase();
const sourceSha=(process.env.GITHUB_HEAD_SHA??process.env.GITHUB_SHA??"").toLowerCase();
const refName=process.env.GITHUB_REF_NAME??"";

if(workflowSha && !isSha40(workflowSha))fail.push("GITHUB_SHA is not a full SHA-1");
if(sourceSha && !isSha40(sourceSha))fail.push("GITHUB_HEAD_SHA is not a full SHA-1");

if(event==="pull_request"){
  if(sourceSha && !isSha40(sourceSha))fail.push("pull-request source SHA invalid");
  try{
    if(sourceSha && execFileSync("git",["merge-base","--is-ancestor",sourceSha,head],{stdio:"ignore"})!==undefined){}
  }catch{fail.push("PR source SHA is not an ancestor of the tested merge ref");}
}
if(event==="push" && /^refs\/tags\/v/.test(process.env.GITHUB_REF??"")){
  if(workflowSha && workflowSha!==head.toLowerCase())fail.push("tag workflow SHA does not equal checked-out HEAD");
  const tagSha=run(["rev-list","-n","1",refName]);
  if(tagSha.toLowerCase()!==head.toLowerCase())fail.push("release tag does not resolve to checked-out HEAD");
}

const evidence={
  schema:"GNW.GitReleaseMetadata.v1",
  event,
  ref:process.env.GITHUB_REF??"",
  refName,
  workflowSha:workflowSha||head.toLowerCase(),
  checkedOutSha:head.toLowerCase(),
  sourceSha:sourceSha||head.toLowerCase(),
  treeSha:tree.toLowerCase(),
  tagSha:event==="push"&&/^v/.test(refName)?run(["rev-list","-n","1",refName]).toLowerCase():null,
  dirty:status!=="",
  generatedAt:new Date().toISOString()
};
writeFileSync(process.env.GNW_GIT_METADATA_OUTPUT??"git-release-metadata.json",JSON.stringify(evidence,null,2)+"\n");

if(fail.length){
  console.error("GNW Git release metadata: DENY");
  for(const x of fail)console.error(" - "+x);
  process.exit(1);
}
console.log(JSON.stringify(evidence,null,2));
