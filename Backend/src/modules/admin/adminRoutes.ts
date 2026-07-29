import type { Express, RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { validateBody } from '../../http/validation';

type AdminRouteDependencies = {
  adminPayloadSchema: ZodType;
  profileList: RequestHandler;
  overview: RequestHandler;
  users: RequestHandler;
  listExercises: RequestHandler;
  createExercise: RequestHandler;
  updateExercise: RequestHandler;
  deleteExercise: RequestHandler;
  listRecipes: RequestHandler;
  createRecipe: RequestHandler;
  updateRecipe: RequestHandler;
  listFoods: RequestHandler;
  createFood: RequestHandler;
  updateFood: RequestHandler;
  deleteFood: RequestHandler;
};

export const registerAdminRoutes = (app: Express, dependencies: AdminRouteDependencies) => {
  const { adminPayloadSchema } = dependencies;
  app.get('/api/profiles', requireAuth, requireAdmin, dependencies.profileList);
  app.get('/api/admin/overview', dependencies.overview);
  app.get('/api/admin/users', dependencies.users);
  app.get('/api/admin/exercises', dependencies.listExercises);
  app.post('/api/admin/exercises', validateBody(adminPayloadSchema), dependencies.createExercise);
  app.put('/api/admin/exercises/:id', validateBody(adminPayloadSchema), dependencies.updateExercise);
  app.delete('/api/admin/exercises/:id', dependencies.deleteExercise);
  app.get('/api/admin/recipes', dependencies.listRecipes);
  app.post('/api/admin/recipes', validateBody(adminPayloadSchema), dependencies.createRecipe);
  app.put('/api/admin/recipes/:id', validateBody(adminPayloadSchema), dependencies.updateRecipe);
  app.get('/api/admin/foods', dependencies.listFoods);
  app.post('/api/admin/foods', validateBody(adminPayloadSchema), dependencies.createFood);
  app.put('/api/admin/foods/:id', validateBody(adminPayloadSchema), dependencies.updateFood);
  app.delete('/api/admin/foods/:id', dependencies.deleteFood);
};
