# Changelog

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
* **infra:** add a local postgres stack behind `bun run infra:up` ([a258542](https://github.com/d0nwong/foundry/commit/a25854272b4bb659d692b1112b3184044a5aebbf))
* **infra:** local postgres stack behind `bun run infra:up` ([21cf2e9](https://github.com/d0nwong/foundry/commit/21cf2e94499ae9991ca0154b78e36d43250a9031))
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
