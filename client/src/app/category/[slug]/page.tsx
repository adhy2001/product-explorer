'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

export default function CategoryPage() {
  const params = useParams();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    
    fetch(`https://product-explorer-bah1.onrender.com/scraping/category/${params.slug}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed');
        return res.json();
      })
      .then((data) => {
        setProducts(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [params.slug]);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <Link href="/" className="text-blue-500 hover:underline mb-6 inline-block">
        ← Back to Categories
      </Link>
      
      <h1 className="text-3xl font-bold text-gray-800 mb-8 capitalize">
        {params.slug ? params.slug.toString().replace(/-/g, ' ') : ''} Books
      </h1>

      {loading && <div className="text-gray-500">Loading live data...</div>}
      
      {error && (
        <div className="bg-red-100 text-red-700 p-4 rounded">
           Error loading products. The category might be empty or the site blocked us.
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {products.map((book) => (
            
            <Link 
              href={`/product/${book.source_id}`} 
              key={book.id}
              className="bg-white rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 group cursor-pointer block"
            >
              <div className="h-64 bg-gray-200 relative overflow-hidden">
                {book.image_url ? (
                  <img 
                    src={book.image_url} 
                    alt={book.title} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400">No Image</div>
                )}
                <div className="absolute top-2 right-2 bg-white px-2 py-1 rounded-md text-sm font-bold shadow-sm text-green-700">
                   {book.price}
                </div>
              </div>
              
              <div className="p-5">
                <h3 className="font-bold text-gray-800 line-clamp-2 min-h-[3.5rem] group-hover:text-blue-600 transition-colors">
                    {book.title}
                </h3>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
