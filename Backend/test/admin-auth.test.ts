import { afterEach, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireAdmin } from '../src/auth/middleware';

afterEach(() => vi.unstubAllEnvs());
function context(role: string, aal: string) {
  const token = `verified.${Buffer.from(JSON.stringify({aal})).toString('base64url')}.signature`;
  const req = {auth:{user:{app_metadata:{role}},accessToken:token}} as Request;
  const res = {status:vi.fn(),json:vi.fn()} as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res);
  const next = vi.fn();
  return {req,res,next};
}
it('does not let a user with MFA become an administrator', () => {
  vi.stubEnv('REQUIRE_ADMIN_MFA','true');
  const {req,res,next} = context('user','aal2'); requireAdmin(req,res,next);
  expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
});
it('requires a verified second factor for admin access when enforced', () => {
  vi.stubEnv('REQUIRE_ADMIN_MFA','true');
  const first = context('admin','aal1'); requireAdmin(first.req,first.res,first.next);
  expect(first.next).not.toHaveBeenCalled(); expect(first.res.status).toHaveBeenCalledWith(403);
  const second = context('admin','aal2'); requireAdmin(second.req,second.res,second.next);
  expect(second.next).toHaveBeenCalledOnce();
});
