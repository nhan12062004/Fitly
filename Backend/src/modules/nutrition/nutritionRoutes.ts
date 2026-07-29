import type { Express, RequestHandler } from 'express';

type NutritionRouteDependencies = {
  validateFoods: RequestHandler;
  getRecipe: RequestHandler;
};

export const registerNutritionRoutes = (app: Express, dependencies: NutritionRouteDependencies) => {
  app.post('/api/meal-plans/validate-foods', dependencies.validateFoods);
  app.get('/api/recipes/:id', dependencies.getRecipe);
};
