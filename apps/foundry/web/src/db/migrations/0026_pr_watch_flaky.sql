-- CTD-234: the head commit a check follow-up could not reproduce -- the host
-- sets this once it has posted the flaky verdict and reran that commit's
-- failed CI jobs once more, so the watcher spends no further rerun or check
-- follow-up on it.
ALTER TABLE "foundry"."pr_watches" ADD COLUMN "flaky_sha" text;
