'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

const CATEGORIES = [
  { name: 'Fiction', slug: 'fiction-books', color: 'bg-blue-500' },
  { name: 'Non-Fiction', slug: 'non-fiction-books', color: 'bg-green-500' },
  { name: 'Children\'s', slug: 'childrens-books', color: 'bg-yellow-500' },
  { name: 'Rare Books', slug: 'rare-books', color: 'bg-purple-500' },
  { name: 'History', slug: 'history-books', color: 'bg-red-500' },
  { name: 'Adventure', slug: 'adventure-books', color: 'bg-orange-500' },
];

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);

  // Real-time Search
  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      return;
    }

    const delayDebounce = setTimeout(() => {
      fetch(`https://product-explorer-bah1.onrender.com/scraping/search?q=${query}`)
        .then(res => res.json())
        .then(data => setResults(data));
    }, 300); // Wait 300ms after typing stops

    return () => clearTimeout(delayDebounce);
  }, [query]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-10 font-sans">
      
      {/* Header */}
      <h1 className="text-5xl font-extrabold text-blue-900 mb-4 tracking-tight">
        Product Explorer
      </h1>
      <p className="text-gray-500 text-lg mb-10">
        Search for a book or select a category to start scraping.
      </p>

      {/* SEARCH BAR */}
      <div className="w-full max-w-2xl relative mb-12">
        <input
          type="text"
          placeholder="Search for books (e.g., 'Harry Potter')..."
          className="w-full p-5 pl-6 text-lg rounded-full border-2 border-gray-200 focus:border-blue-500 focus:outline-none shadow-sm transition-all text-black"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        
        {/* Search Results Dropdown */}
        {results.length > 0 && (
          <div className="absolute top-full left-0 right-0 bg-white mt-2 rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden max-h-96 overflow-y-auto">
            {results.map((book) => (
              <Link 
                href={`/product/${book.source_id}`} 
                key={book.id}
                className="flex items-center gap-4 p-4 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
              >
                {book.image_url && (
                   <img src={book.image_url} className="w-10 h-14 object-cover rounded shadow-sm" />
                )}
                <div>
                   <div className="font-bold text-gray-800">{book.title}</div>
                   <div className="text-sm text-green-600 font-bold">{book.price}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-4xl">
        {CATEGORIES.map((cat) => (
          <Link 
            href={`/category/${cat.slug}`} 
            key={cat.slug}
            className={`${cat.color} text-white p-8 rounded-2xl shadow-lg hover:scale-105 hover:shadow-2xl transition-all duration-300 flex items-center justify-between group`}
          >
            <span className="text-2xl font-bold">{cat.name}</span>
            <span className="text-3xl group-hover:translate-x-2 transition-transform">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
