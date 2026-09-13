# Changelog

## [1.1.0](https://github.com/d0nwong/citadel/compare/v1.0.0...v1.1.0) (2026-09-13)


### Features

* **argus,pensieve:** reconcile settles tickets from Linear and from landings ([59b7107](https://github.com/d0nwong/citadel/commit/59b71078cdcb20856ea4ca56da3786bed65a933a))
* **argus,pensieve:** reconcile settles tickets from Linear as well as landings ([a531d15](https://github.com/d0nwong/citadel/commit/a531d151fb9e6300753363db60d05b4e01abb2d1))
* **argus:** reconcile folds a Done revision and archives a Cancelled one (CTD-196) ([d0942f7](https://github.com/d0nwong/citadel/commit/d0942f7ab8cdb5a85dbb8fef434b91125e03b1c6))
* **argus:** reconcile folds a Done revision and archives a Cancelled one (CTD-196) ([6ca5c40](https://github.com/d0nwong/citadel/commit/6ca5c4031a9730c86da2266df6e5c259b57f9798))
* **argus:** the /scope skill — a ramble, interviewed into a filed revision (CTD-194) ([489ea4f](https://github.com/d0nwong/citadel/commit/489ea4fb878d7a7574ca0841e3f05c7c560d3719))
* **argus:** the revision record — revisions/, revision.json and the four verbs (CTD-193) ([a3dbb42](https://github.com/d0nwong/citadel/commit/a3dbb42781c091a148dbd5b18abb30497e6fe3f0))
* **argus:** the revision record — revisions/, revision.json and the four verbs (CTD-193) ([6720998](https://github.com/d0nwong/citadel/commit/6720998f8c3021135b4b87299a53d78c58eaafcd))
* **flows:** Citadel's core flows as React Flow maps, starting with /scope ([41e4bad](https://github.com/d0nwong/citadel/commit/41e4badc16d434e893910bcdc1220d299825e619))
* **foundry:** a flake gets one rerun in forge-verify and forge-implement ([b7f29d0](https://github.com/d0nwong/citadel/commit/b7f29d09501877ec1d7b12944dd1e049fed328b7))
* **foundry:** a flake gets one rerun in forge-verify and forge-implement ([b0f44ec](https://github.com/d0nwong/citadel/commit/b0f44ec3ea96e5815ea0bbe1513856b8a3733546))
* **foundry:** a pnpm store and npm cache shared across job containers ([32b0464](https://github.com/d0nwong/citadel/commit/32b0464c26823076cfd094ca5351c8aa0b6174c3))
* **foundry:** a pnpm store and npm cache shared across job containers ([461e25a](https://github.com/d0nwong/citadel/commit/461e25a4a181fe107a3c60cf3ea1d8bfaa0261e2))
* **foundry:** forge role skills and the Spec → QA blueprint ([2644b59](https://github.com/d0nwong/citadel/commit/2644b593b485c5318c7ea5b7b832a328a0093c5b))
* **foundry:** forge-api, the API and interface lens (CTD-174) ([0d1fb11](https://github.com/d0nwong/citadel/commit/0d1fb11dbe125dd80f26563a9f5c3f96422240d1))
* **foundry:** forge-simplify and the "Simplify" blueprint (CTD-175) ([898e997](https://github.com/d0nwong/citadel/commit/898e997e526c25d7a228f7c03684caa0df47fb1c))
* **foundry:** forge-ui, the design-language lens (CTD-171) ([9230140](https://github.com/d0nwong/citadel/commit/9230140e5abd2b542fb4e3d827810cb104afe5f9))
* **foundry:** forge-ui, the design-language lens (CTD-171) ([61b6ef2](https://github.com/d0nwong/citadel/commit/61b6ef2c2176524a9d1ce010b52d29ed0ec264e3))
* **foundry:** hand a job its revision's spec and arch doc (CTD-195) ([b539572](https://github.com/d0nwong/citadel/commit/b5395728f3ee3e2356b61bbeb168f92047e4b663))
* **foundry:** hand a job its revision's spec and arch doc (CTD-195) ([50b93ad](https://github.com/d0nwong/citadel/commit/50b93ad22a9f837151169cc724e7bf9d5ec6be46))
* **foundry:** hand a job the files and issues its task names ([a9b47f8](https://github.com/d0nwong/citadel/commit/a9b47f88ce25914fd1e915ae88696dc60a71402d))
* **foundry:** hand a job the files and issues its task names ([3cfb554](https://github.com/d0nwong/citadel/commit/3cfb5544d6fe19f3f8df605092a924303a88ce9d))
* **foundry:** measure the base state once per commit, before any model turn ([e03e143](https://github.com/d0nwong/citadel/commit/e03e143435ba12fec995147183cfe2db3f6350cd))
* **foundry:** measure the base state once per commit, before any model turn ([58b0b5f](https://github.com/d0nwong/citadel/commit/58b0b5ffb7df56ff0cd85caa72d31631cd17335b))
* **foundry:** remove a job's workspace on a clean settle (CTD-181) ([12c7571](https://github.com/d0nwong/citadel/commit/12c7571ac924fcd411d36607235aad8b204e79a3))
* **foundry:** remove a job's workspace on a clean settle (CTD-181) ([7e88875](https://github.com/d0nwong/citadel/commit/7e8887552673a4a7507e0ba88f055bd91871b4e0))
* **foundry:** seed the three-step Spec → PR blueprint (CTD-179) ([95ad9eb](https://github.com/d0nwong/citadel/commit/95ad9eba5af41fe23ed32f5ceb1a96658d67992e))
* **foundry:** Spec → QA v2 — spec, then test-and-implement as one step, then verify (CTD-179) ([accebe1](https://github.com/d0nwong/citadel/commit/accebe11cd4e54e0a131bbac8870289224f5bb08))
* **foundry:** Spec → QA v3 — the build step starts from what its session holds ([ffd810e](https://github.com/d0nwong/citadel/commit/ffd810ee4fec7cf1ccee82464691fb9a3fe9ab1c))
* **foundry:** Spec → QA v3 — the build step starts from what its session holds ([d9fce97](https://github.com/d0nwong/citadel/commit/d9fce97a2bb94d4351b12235ec3b6af942fae0a9))
* **foundry:** the flake rule gets its rationalization row ([79c01d8](https://github.com/d0nwong/citadel/commit/79c01d88fc7163c91b0e3431cdb3e972d9e022eb))
* **foundry:** the PR watcher launches follow-ups on reviews and red checks (CTD-170) ([58b5427](https://github.com/d0nwong/citadel/commit/58b542731b5c31aebca37e5c19bf37c05dc32ee5))
* **foundry:** the PR watcher launches follow-ups on reviews and red checks (CTD-170) ([ab8ab9b](https://github.com/d0nwong/citadel/commit/ab8ab9b3c5ca138301ac8a38f5878c364b09a706))
* **image:** forge-debug skill and the Bug → Fix blueprint ([b145b13](https://github.com/d0nwong/citadel/commit/b145b131f9d8e8855cfee3c7e251997e799019df))
* **image:** forge-debug skill and the Bug → Fix blueprint ([76df74b](https://github.com/d0nwong/citadel/commit/76df74b2e0763a298a6d534c48ade2d3c6ebfad7))
* **image:** forge-spec/plan/test/implement/verify skills for headless QA ([c76b822](https://github.com/d0nwong/citadel/commit/c76b822c7489371d1389d705b942a6603995d33e))
* **pensieve:** file tickets on the team and project the ask names ([f85497e](https://github.com/d0nwong/citadel/commit/f85497e793864c8c688950421ec39ec018422562))
* **scope-flow:** the /scope flow as an interactive React Flow map ([6eb5535](https://github.com/d0nwong/citadel/commit/6eb55351ec4f6fb1b7f2bd049ca82687be774018))
* **web:** draw a follow-up group as a tree hanging off its parent (CTD-183) ([d02f64d](https://github.com/d0nwong/citadel/commit/d02f64d58b41dc6038a1163f97d7b1294b7dc43c))
* **web:** group follow-up jobs under the job whose PR they continue (CTD-183) ([49bc133](https://github.com/d0nwong/citadel/commit/49bc133b6c15ab720c495ba8628a339496b85ed4))
* **web:** group follow-up jobs under the job whose PR they continue (CTD-183) ([c8e3636](https://github.com/d0nwong/citadel/commit/c8e36361777739b1a5b5937939fea33ed6cabace))
* **web:** seed the Spec → QA blueprint ([9e80e34](https://github.com/d0nwong/citadel/commit/9e80e34a2752f149ec5a2c366a66fb6bfd5c9ea6))


### Bug Fixes

* **argus,pensieve:** a ticket with no asks is done once its landing is live ([5673399](https://github.com/d0nwong/citadel/commit/567339918965fb6080b66395ac419aff5602d7c2))
* **foundry:** a criterion cannot make a behaviour change a simplification ([ba7ff3e](https://github.com/d0nwong/citadel/commit/ba7ff3e6d869a9b9350d53bf0a2c79be40b40096))
* **foundry:** forge-ui reads only the recipes the change uses ([bc688a1](https://github.com/d0nwong/citadel/commit/bc688a1e38866f9ff3af319181f4e2b8d84c9183))
* **foundry:** spend the job budget once — commit-first verify, one suite run per step ([dca990a](https://github.com/d0nwong/citadel/commit/dca990ac7c25ed4fd67f14136d813326b6987e00))
* **foundry:** spend the job budget once — commit-first verify, one suite run per step ([5029398](https://github.com/d0nwong/citadel/commit/50293988550d50961866e2a943fd4264f9ead519))
* **image:** forge-debug closes only the ticket the task names ([a88f22f](https://github.com/d0nwong/citadel/commit/a88f22fc859b06706f08c8c3955e8f28cc42eff0))
* **image:** forge-spec requires an Acceptance Criteria section ([4d1d3bb](https://github.com/d0nwong/citadel/commit/4d1d3bbeedb47623dc47cafb813b8a5912ee3297))
* **image:** forge-verify commits with a Conventional Commit subject ([4df22c6](https://github.com/d0nwong/citadel/commit/4df22c6dfdee0d06ba7d5e837f8554208ba3b2ba))
* **image:** forge-verify reverts files only the formatter touched ([4a1b0f4](https://github.com/d0nwong/citadel/commit/4a1b0f4ccc59858b64a4b18044873c5165fce6bd))
* **web:** release a ticket's claim when its job is cancelled ([232fcec](https://github.com/d0nwong/citadel/commit/232fcec6320299db1145df110d15401ef61f59d6))
* **web:** release a ticket's claim when its job is cancelled ([580b7a7](https://github.com/d0nwong/citadel/commit/580b7a7c97c680f85d3b58095fff1d6b6ee51f29))
* **web:** thin scrollbar on the job sheet's task and log panes ([5f7149c](https://github.com/d0nwong/citadel/commit/5f7149c73d9150ef61d6910cec6d208a788ad372))
* **web:** thin scrollbar on the job sheet's task and log panes ([deef33e](https://github.com/d0nwong/citadel/commit/deef33ea6c594f9533f1ae76a626a443a070e428))

## 1.0.0 (2026-09-12)


### Features

* **argus:** read data from ARGUS_ROOT everywhere ([ff83830](https://github.com/d0nwong/citadel/commit/ff83830dee3aede77668de3a3ad12cbb378166eb))
* **argus:** the sweep as a compose service, off until cutover ([59d940d](https://github.com/d0nwong/citadel/commit/59d940d77ac427b708f99c21caa6459d80fcdf6d))
* Foundry web stays on the host for step 1; just foundry runs it ([9c1ca7f](https://github.com/d0nwong/citadel/commit/9c1ca7f6f397f7fff84321f12491796c5ae32433))
* just auth gh and just auth bitbucket ([e0e6688](https://github.com/d0nwong/citadel/commit/e0e66884995fa63b09d4d65a2615af60652a347a))
* just bootstrap, check and auth replace three bootstrap scripts ([c1ca128](https://github.com/d0nwong/citadel/commit/c1ca128210fb3a727efeb1e07f2f2411d34665d5))
* just link, for cutover ([c1f5bc9](https://github.com/d0nwong/citadel/commit/c1f5bc907723e00ffbdeb735f5aa6d374cddf100))
* just up starts the sweep loop with the stack ([ee69232](https://github.com/d0nwong/citadel/commit/ee692325a026b8132d4fdfc73d305062cf1ee933))
* one .env at the citadel root for every app ([20b44af](https://github.com/d0nwong/citadel/commit/20b44afa1b8c292edd7bcba3ae4e36699869ef2f))
* one compose stack and just recipes for it ([7b09d46](https://github.com/d0nwong/citadel/commit/7b09d46c477afe5d1ca7e68587e2599743897ad8))
* **pensieve:** run argus from its code, against its data ([d717203](https://github.com/d0nwong/citadel/commit/d7172039037bf1337030c4dbeed65e5c554f4048))
* **pensieve:** run Pensieve in the stack ([50f52c8](https://github.com/d0nwong/citadel/commit/50f52c87baa1b1f925dbdbf589b8b0c803dfb9b6))


### Bug Fixes

* **argus:** the 12 unchecked indexes accio's typecheck flagged ([1bc01e4](https://github.com/d0nwong/citadel/commit/1bc01e4b7a8fadc953ff017da3b2547ed77b6089))
* release-dry reads citadel with gh's token ([42581ed](https://github.com/d0nwong/citadel/commit/42581ed1e83b6026d47686e3d27046e98ed5a8ff))


### Miscellaneous Chores

* release citadel as one package, starting at 1.0.0 ([f7c18e9](https://github.com/d0nwong/citadel/commit/f7c18e9e55bcbc15ee217a4e6294b4223b065d78))
