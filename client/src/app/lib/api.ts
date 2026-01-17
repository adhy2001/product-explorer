import axios from 'axios';

// Create a single connection instance
const api = axios.create({
  baseURL: 'http://localhost:3000', // Point to your NestJS server
});

// Helper function to get navigation items
// 👇 MAKE SURE "export" IS HERE
export const getNavigation = async () => {
  const response = await api.get('/navigation');
  return response.data;
};

// Helper function to get category products (for the drilldown page)
// 👇 MAKE SURE "export" IS HERE TOO
export const getCategoryProducts = async (slug: string) => {
  const response = await api.get(`/scraping/category/${slug}`);
  return response.data;
};

export default api;