# Changelog

## [1.5.0](https://github.com/d0nwong/citadel/compare/foundry-v1.4.0...foundry-v1.5.0) (2026-09-12)


### Features

* just bootstrap, check and auth replace three bootstrap scripts ([c1ca128](https://github.com/d0nwong/citadel/commit/c1ca128210fb3a727efeb1e07f2f2411d34665d5))
* one .env at the citadel root for every app ([20b44af](https://github.com/d0nwong/citadel/commit/20b44afa1b8c292edd7bcba3ae4e36699869ef2f))
* one compose stack and just recipes for it ([7b09d46](https://github.com/d0nwong/citadel/commit/7b09d46c477afe5d1ca7e68587e2599743897ad8))

## [1.4.0](https://github.com/d0nwong/foundry/compare/foundry-v1.3.0...foundry-v1.4.0) (2026-09-05)


### Features

* **infra:** add Slack to the MCP gateway, with an interactive foundry auth ([f9d67e6](https://github.com/d0nwong/foundry/commit/f9d67e6dd199d31d3f76ae8b7624201326a2550d))
* **infra:** add Slack to the MCP gateway, with an interactive foundry auth ([812ad91](https://github.com/d0nwong/foundry/commit/812ad9190a612b0a824ed290be38fe120f29f3b7))
* **jobs:** add rerun-as-new-job button (LIA-26) ([8a495e1](https://github.com/d0nwong/foundry/commit/8a495e1cf042e47b7f9f962253a0739844218a82))
* **jobs:** add rerun-as-new-job button (LIA-26) ([686650c](https://github.com/d0nwong/foundry/commit/686650c3549e000b50717ca5551de10cdc1cc072))
* **scripts:** bootstrap a new machine with shell setup scripts ([61040ef](https://github.com/d0nwong/foundry/commit/61040efa61dd4ac696ab497dbc38e915736065b8))
* **scripts:** bootstrap a new machine with shell setup scripts ([ffaad62](https://github.com/d0nwong/foundry/commit/ffaad62e09fd027e2dd48a92bc8065ebefd87bf8))
* **web:** add per-repo notes and a ledger-derived base branch default ([335ce61](https://github.com/d0nwong/foundry/commit/335ce61a79d1cdcdbf42a79de0527d04ed1721bd))
* **web:** add per-repo notes and a ledger-derived base branch default ([a69ef2b](https://github.com/d0nwong/foundry/commit/a69ef2bbb88802924a4a625b0aab6c2c6f5557b2))
* **web:** address PR comments with a follow-up job ([5a32ba8](https://github.com/d0nwong/foundry/commit/5a32ba82fda4abc536c75ebae868c1669778ad8d))
* **web:** address PR comments with a follow-up job ([2ce967e](https://github.com/d0nwong/foundry/commit/2ce967e16d174aa43cf402ff00e68338a3f18846))
* **web:** collapsible sections and sticky step bars in the job sheet ([b35bfb2](https://github.com/d0nwong/foundry/commit/b35bfb2acf36a527e91d73595125869ccc5cc227))
* **web:** collapsible sections and sticky step bars in the job sheet ([89c3070](https://github.com/d0nwong/foundry/commit/89c30701d840232effb2f79568fdf65a00f65d4f))
* **web:** infinite scroll for jobs list (LIA-16) ([bb2bf9f](https://github.com/d0nwong/foundry/commit/bb2bf9f7f15e2381bed65d9a3efefe435c4958aa))
* **web:** link Bitbucket PRs to their Linear ticket ([38eeb32](https://github.com/d0nwong/foundry/commit/38eeb320030e45e64bc79a315bdc912a3d5988d7))
* **web:** link Bitbucket PRs to their Linear ticket ([3be4086](https://github.com/d0nwong/foundry/commit/3be4086c4220c616daf53f58e25f9b8b97de9aee))
* **web:** scan Linear for agent-ready tickets and ignite jobs ([80f71ab](https://github.com/d0nwong/foundry/commit/80f71ab2b95b01a569c254576ed50fb85e69cef3))
* **web:** scan Linear for agent-ready tickets and ignite jobs ([c8ca720](https://github.com/d0nwong/foundry/commit/c8ca72001afb459c8018f6de14e8c78a17e76344))
* **web:** seed two blueprints and default new jobs to Plan → Execute ([7e18ef7](https://github.com/d0nwong/foundry/commit/7e18ef73b76d51a4b3b868e125f47d8a39e5f8c5))
* **web:** seed versioned blueprints and default new jobs to Plan → Execute ([50e9219](https://github.com/d0nwong/foundry/commit/50e921953d7a1800160b4c278ecc41f172427ea2))
* **web:** store forge session logs as JSONL files instead of db rows ([cd23ab2](https://github.com/d0nwong/foundry/commit/cd23ab2db6fc339e7bdad06b38d3f14b6ffa79a1))
* **web:** store forge session logs as JSONL files instead of db rows ([49c5e0e](https://github.com/d0nwong/foundry/commit/49c5e0eafea2f6701743d8ac68a7c1eec47fe0c2))
* **web:** trigger jobs over HTTP with a signed completion webhook ([945421a](https://github.com/d0nwong/foundry/commit/945421a5da2097cfe2e7a6b27252bcd796cb8a7b))
* **web:** trigger jobs over HTTP with a signed completion webhook ([942590f](https://github.com/d0nwong/foundry/commit/942590f75734705271f254aeab8f22234e305a10))
* **web:** version blueprints so prompts can be improved incrementally ([7a2b5b9](https://github.com/d0nwong/foundry/commit/7a2b5b9f889df93fc04d9118793dfd3a0eacf16c))


### Bug Fixes

* **cli:** resolve symlinks when deriving ROOT ([02e5823](https://github.com/d0nwong/foundry/commit/02e58231e389f887edb0b50e68aa3cfa55ae9cd3))
* **cli:** resolve symlinks when deriving ROOT ([a39759c](https://github.com/d0nwong/foundry/commit/a39759cfc40cd63aa1ebff96a2c434f5be7dc916))
* guarantee forge PRs a template-shaped description ([f83c2d8](https://github.com/d0nwong/foundry/commit/f83c2d872a050dc2d12a199b38d79c5f04d14fe0))
* guarantee forge PRs a template-shaped description ([cf978c8](https://github.com/d0nwong/foundry/commit/cf978c8cf6a9cc2f3a5e4537f5687c8d58937678))
* **image:** put pnpm on the forge PATH via corepack ([e353781](https://github.com/d0nwong/foundry/commit/e3537815e254e4c0993f3953188bd25a4c2261b9))
* **image:** put pnpm on the forge PATH via corepack ([63920a4](https://github.com/d0nwong/foundry/commit/63920a4b497dca1fa76d1e429742b03e36165e5d))
* keep repo workflow skills from derailing headless forge jobs ([3130080](https://github.com/d0nwong/foundry/commit/31300802413a42e68e2c74564818dfede2ffaa0c))
* keep repo workflow skills from derailing headless forge jobs ([8e80350](https://github.com/d0nwong/foundry/commit/8e80350d74e4bc60a2a8c194082a4cf7ba061629))
* **web:** capitalize Forge in ignite dialog description ([aac3edb](https://github.com/d0nwong/foundry/commit/aac3edb0759e80b662056ee23bafe556a179b3a4))
* **web:** compose forge PR bodies from the repo PR template ([2a4d12f](https://github.com/d0nwong/foundry/commit/2a4d12f2b4928c525bccffe7bb4ca0fa634d6524))
* **web:** give each job a unique branch name ([718c2b4](https://github.com/d0nwong/foundry/commit/718c2b4204fb5d1e40def97cbf23f9eabb525104))
* **web:** give each job a unique branch name ([392c5b9](https://github.com/d0nwong/foundry/commit/392c5b9fa1b28b58d441f3b74b35bdbe127e3aae))
* **web:** hide scrollbars in the job detail drawer ([2530d5b](https://github.com/d0nwong/foundry/commit/2530d5b6fda7639b3719e353a995bb350aab64c0))
* **web:** keep job logs visible when task description is long ([d17f7ab](https://github.com/d0nwong/foundry/commit/d17f7abf01b7e72b5a8eca15cf3ed87eb1ce18fb))
* **web:** link Bitbucket PRs to Linear tickets named in the task text ([410be1a](https://github.com/d0nwong/foundry/commit/410be1aaaa2e209f3df7def020c07ebcb963965f))
* **web:** link Bitbucket PRs to Linear tickets named in the task text ([7495ac1](https://github.com/d0nwong/foundry/commit/7495ac10f116bc5d7a3f404174a44e15c40f9fca))
* **web:** rename "forge a job" copy to "ignite" ([fd96676](https://github.com/d0nwong/foundry/commit/fd96676ecd193968feb42332fbe3b394530257ab))
* **web:** rename "forge a job" copy to "ignite" ([d0d1a85](https://github.com/d0nwong/foundry/commit/d0d1a85cb5857adcea7df2a504f2f31fc29f1314))

## [1.3.0](https://github.com/d0nwong/foundry/compare/foundry-v1.2.0...foundry-v1.3.0) (2026-08-24)


### Features

* add foundry setup one-time bootstrap command ([2a500e7](https://github.com/d0nwong/foundry/commit/2a500e7efaefe1c71464104b5fb062c07617aafd))
* add foundry setup one-time bootstrap command ([3e0652a](https://github.com/d0nwong/foundry/commit/3e0652a4ae2a2eb8b5c65482857ff1fdfd6b9e06))

## [1.2.0](https://github.com/d0nwong/foundry/compare/foundry-v1.1.0...foundry-v1.2.0) (2026-08-24)


### Features

* **cli:** add foundry version subcommand ([2039d41](https://github.com/d0nwong/foundry/commit/2039d41a6d67854a728573e03e953d34b83207de))
* **cli:** add foundry version subcommand ([e105e19](https://github.com/d0nwong/foundry/commit/e105e195fc5f49875948d935dab116224b78e65d))
* **web:** blueprints — multi-step jobs with a model per step ([da58dc7](https://github.com/d0nwong/foundry/commit/da58dc70dbcc6dc518bfb508bb85da038918f955))
* **web:** blueprints — multi-step jobs with a model per step ([fd54021](https://github.com/d0nwong/foundry/commit/fd5402173e8c22be6d6b618adce026e7f1c087aa))
* **web:** fold blueprint step logs into collapsible sections ([a4f13f9](https://github.com/d0nwong/foundry/commit/a4f13f90102c98ac41515d7a8bd70e0924da03d3))

## [1.1.0](https://github.com/d0nwong/foundry/compare/foundry-v1.0.0...foundry-v1.1.0) (2026-08-24)


### Features

* **image:** add bun to the forge image ([ffdf31f](https://github.com/d0nwong/foundry/commit/ffdf31fe8c3129f3eb4bbf5e6f9525565deb9f67))
* **image:** ship a /work skill into every forge ([04f9f19](https://github.com/d0nwong/foundry/commit/04f9f19d3a5ddce8139aec6375302d32bf75c164))
* **image:** ship a /work skill into every forge ([6ff4c6e](https://github.com/d0nwong/foundry/commit/6ff4c6ea29ee8fb0e51403162f34fadbae33e1d2))
* **infra:** add mcp-proxy gateway service ([671e5f3](https://github.com/d0nwong/foundry/commit/671e5f370bff6efc8a0e26c82c5b988218550b5f))
* **infra:** mcp gateway so forges can reach linear ([ecb8aef](https://github.com/d0nwong/foundry/commit/ecb8aeff5144f4227f95c910d5acc78cb41531f9))
* route forges to the MCP gateway ([8d9961f](https://github.com/d0nwong/foundry/commit/8d9961f23131dd0901f3e3365c40066c42f61e8c))
* **web:** add purge jobs button with confirmation dialog ([7801864](https://github.com/d0nwong/foundry/commit/780186472d5982b106e0f23859fb662a85e81f66))
* **web:** add purge jobs button with confirmation dialog ([0e096ed](https://github.com/d0nwong/foundry/commit/0e096edc2484f9ef3bfa1e1651453870ab3c2fa2))


### Bug Fixes

* **image:** /work skips branching inside a job forge ([d2d6d23](https://github.com/d0nwong/foundry/commit/d2d6d2355f628265882aa6c3ebcd6cafe5bbede2))
* **image:** count agent-made commits as job output ([e668f10](https://github.com/d0nwong/foundry/commit/e668f1037b3f1940ce11daba1775e4f71cde9177))
* **image:** let /work plan without plan mode when headless ([282bbda](https://github.com/d0nwong/foundry/commit/282bbda82e8ea42edb60425cf69c132187c641e1))
* **image:** tell headless job runs they are unattended ([a8c4345](https://github.com/d0nwong/foundry/commit/a8c4345b8e6458f861f9a73206fcc45e23afcaa5))

## [1.0.0](https://github.com/d0nwong/foundry/compare/foundry-v0.1.0...foundry-v1.0.0) (2026-08-23)


### Features

* add foundry CLI for Claude Code forges on OrbStack ([7401dbb](https://github.com/d0nwong/foundry/commit/7401dbb09c510f79a9350acfd857a3b179ca74dc))
* **infra:** add a local postgres stack behind `just up postgres` ([a258542](https://github.com/d0nwong/foundry/commit/a25854272b4bb659d692b1112b3184044a5aebbf))
* **infra:** local postgres stack behind `just up postgres` ([21cf2e9](https://github.com/d0nwong/foundry/commit/21cf2e94499ae9991ca0154b78e36d43250a9031))
* **web:** add TanStack Start + shadcn POC frontend ([647dbdf](https://github.com/d0nwong/foundry/commit/647dbdfa05a8f8907bdedff03a9482c9b8564f87))
* **web:** curate repos, and make discovery real ([6b258cd](https://github.com/d0nwong/foundry/commit/6b258cd00784241dfbf7eae1cb3c69e52375505c))
* **web:** make the UI responsive ([3654b46](https://github.com/d0nwong/foundry/commit/3654b46983c7d6f701d73bd32e9a6be788391af0))
* **web:** persist jobs and imported repos in postgres ([018268a](https://github.com/d0nwong/foundry/commit/018268acba0fe03acfd6a8c27700882f51a4f1c4))
* **web:** persist jobs and imported repos in postgres ([b62924c](https://github.com/d0nwong/foundry/commit/b62924c011ec6739d0788ac01204c72c49eec600))
* **web:** run jobs in ephemeral forges and open a PR ([76bd3ed](https://github.com/d0nwong/foundry/commit/76bd3ed67f352523e4cf56af091e5610634d9bcb))
* **web:** run jobs in ephemeral forges and open a PR ([520cb0c](https://github.com/d0nwong/foundry/commit/520cb0cf5ddaf81bb206c5c7e7c591ee9a4649b2))


### Bug Fixes

* **web:** allow MagicDNS hosts through the dev server ([2bad0df](https://github.com/d0nwong/foundry/commit/2bad0df9693212aa1627642a9820d951d8770380))
* **web:** harden the job lifecycle, default base to origin's default branch ([33fcf08](https://github.com/d0nwong/foundry/commit/33fcf0880297e5367a5a69205350da5d4a6db143))
* **web:** job workspaces report the repo's real default branch ([00f9798](https://github.com/d0nwong/foundry/commit/00f9798855a6391f71d8d8f8b272258c57e8f6e8))
* **web:** job workspaces report the repo's real default branch ([0e54e54](https://github.com/d0nwong/foundry/commit/0e54e54b5fc555eb9c5f08329e2ec7d79a91982a))
* **web:** restore the responsive layout lost by PR [#4](https://github.com/d0nwong/foundry/issues/4)'s base branch ([b412574](https://github.com/d0nwong/foundry/commit/b412574cd2f19eae6042dc0207dc12d6438a3a7a))
