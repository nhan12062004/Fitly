import type { RequestHandler } from 'express';
import { performance } from 'node:perf_hooks';
import { logOperational } from '../lib/operationalLogger';

const limits = [100,300,1000,3000,10000,Infinity];
const state = {requests:0,serverErrors:0,rateLimited:0,totalDurationMs:0,buckets:limits.map(() => 0)};
export const requestMetrics: RequestHandler = (req,res,next) => {
  if (!req.path.startsWith('/api/')) return next();
  const started = performance.now();
  res.once('finish',() => {
    const duration = Math.round(performance.now()-started);
    state.requests += 1; state.totalDurationMs += duration;
    state.buckets[limits.findIndex((limit) => duration <= limit)] += 1;
    if (res.statusCode >= 500) state.serverErrors += 1;
    if (res.statusCode === 429) state.rateLimited += 1;
    if (res.statusCode >= 500 || res.statusCode === 429 || duration > 1000) logOperational({
      level:res.statusCode>=500?'error':'warn',event:'http_request_completed',requestId:req.requestId,
      status:String(res.statusCode),durationMs:duration,message:`${req.method} ${req.route?.path || 'unmatched'}`,
    });
  });
  next();
};
export const snapshotHttpMetrics = () => ({
  requests:state.requests,serverErrors:state.serverErrors,rateLimited:state.rateLimited,
  averageDurationMs:state.requests?Math.round(state.totalDurationMs/state.requests):0,
  latencyBuckets:limits.map((limit,index) => ({upperBoundMs:Number.isFinite(limit)?limit:null,count:state.buckets[index]})),
});
