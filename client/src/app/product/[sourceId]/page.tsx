'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function ProductPage() {
  const params = useParams();
  const router = useRouter();
  const [book, setBook] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 👇 UPDATED: Uses your live Render URL
    fetch(`https://product-explorer-bah1.onrender.com/scraping/product/${params.sourceId}`)
      .then((res) => res.json())
      .then((data) => {
        setBook(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [params.sourceId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-xl font-semibold text-blue-600 animate-pulse">
          📖 Reading book details...
        </div>
      </div>
    );
  }

  if (!book) return <div className="p-10">Book not found.</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <button 
        onClick={() => router.back()}
        className="mb-6 text-gray-500 hover:text-blue-600 flex items-center gap-2 transition-colors"
      >
        ← Back to Browse
      </button>

      <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row">
        
        {/* Left: Image Section */}
        <div className="md:w-1/3 bg-gray-100 p-8 flex items-center justify-center">
          {book.image_url ? (
            <img 
              src={book.image_url} 
              alt={book.title} 
              className="max-h-[500px] shadow-lg rounded-md object-contain"
            />
          ) : (
            <div className="h-64 w-48 bg-gray-200 rounded flex items-center justify-center text-gray-400">
              No Cover
            </div>
          )}
        </div>

        {/* Right: Details Section */}
        <div className="md:w-2/3 p-10 flex flex-col">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{book.title}</h1>
          <p className="text-2xl text-green-600 font-bold mb-6">{book.price}</p>

          <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 mb-6">
            <h3 className="font-semibold text-blue-800 mb-2">Book Summary</h3>
            <p className="text-gray-700 leading-relaxed">
              {book.details?.description || "No description available for this book."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6 text-sm text-gray-600 border-t pt-6 mt-auto">
            <div>
              <span className="block font-semibold text-gray-900">Publisher</span>
              {book.details?.publisher || "Unknown"}
            </div>
            <div>
              <span className="block font-semibold text-gray-900">ISBN</span>
              {book.details?.isbn || "N/A"}
            </div>
            <div>
              <span className="block font-semibold text-gray-900">Last Scraped</span>
              {new Date(book.last_scraped_at).toLocaleDateString()}
            </div>
            <div>
              <a 
                href={book.source_url} 
                target="_blank" 
                rel="noreferrer"
                className="text-blue-600 hover:underline font-semibold"
              >
                View on World of Books ↗
              </a>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}