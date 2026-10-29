import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

for (const [github,runner] of [["false","github-hosted"],["true","self-hosted"]]) {
  test(`desktop installers refuse github=${github}, runner=${runner} before creating files`,()=>{
    const temp=mkdtempSync(join(tmpdir(),"va-isolation-"));
    try {
      for(const script of ["build.mjs","linux.mjs"]){
        const result=spawnSync(process.execPath,[resolve("scripts/desktop",script)],{env:{...process.env,GITHUB_ACTIONS:github,RUNNER_ENVIRONMENT:runner,RUNNER_TEMP:temp,VA_DESKTOP_ROOT:join(temp,"va-desktop")},encoding:"utf8"});
        expect(result.status).not.toBe(0);expect(result.stderr).toContain(github==="false"?"disposable GitHub-hosted runner":"Self-hosted/user machines");
        expect(existsSync(join(temp,"va-desktop"))).toBe(false);
      }
    } finally { rmdirSync(temp); }
  });
}
