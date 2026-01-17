import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000', 
});

// Helper function to get navigation items
export const getNavigation = async () => {
  const response = await api.get('/navigation');
  return response.data;
};

// Helper function to get category products (for the drilldown page)
export const getCategoryProducts = async (slug: string) => {
  const response = await api.get(`/scraping/category/${slug}`);
  return response.data;
};

export default api;
