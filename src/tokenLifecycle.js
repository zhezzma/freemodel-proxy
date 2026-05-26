export function shouldClearFreezeOnOk(lastFreezeAt, requestStartedAt) {
  return !Number.isFinite(lastFreezeAt) || lastFreezeAt <= requestStartedAt;
}
