import React, { useEffect } from "react";

const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  const handlePrevious = () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  };

  const renderPageNumbers = () => {
    const pageNumbers = [];

    // Show fewer buttons on mobile
    const maxVisible = window.innerWidth < 640 ? 3 : 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);

    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pageNumbers.push(
        <button
          key={i}
          onClick={() => onPageChange(i)}
          className={`inline-flex items-center justify-center min-w-[36px] px-3 py-1.5 border text-sm font-medium transition-all duration-150 ${
            currentPage === i
              ? "bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-500 dark:border-indigo-500"
              : "bg-white border-gray-300 text-gray-600 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600"
          } rounded-md`}
        >
          {i}
        </button>
      );
    }

    return pageNumbers;
  };

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft') {
        if (currentPage > 1) onPageChange(currentPage - 1)
      }
      if (e.key === 'ArrowRight') {
        if (currentPage < totalPages) onPageChange(currentPage + 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentPage, totalPages, onPageChange])

  return (
    <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-6 px-3 sm:px-6 py-3 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
      {/* Mobile View (Compact) */}
      <div className="flex items-center justify-between w-full sm:hidden">
        <button
          onClick={handlePrevious}
          disabled={currentPage === 1}
          className="flex-1 mr-2 inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:disabled:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95 transition-transform"
        >
          Prev
        </button>
        <span className="text-sm text-gray-600 whitespace-nowrap">
          Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
        </span>
        <button
          onClick={handleNext}
          disabled={currentPage === totalPages}
          className="flex-1 ml-2 inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:disabled:bg-gray-800"
        >
          Next
        </button>
      </div>

      {/* Desktop / Tablet View */}
      <div className="hidden sm:flex sm:items-center sm:justify-between w-full">
        <p className="text-sm text-gray-700">
          Page <span className="font-semibold">{currentPage}</span> of{" "}
          <span className="font-semibold">{totalPages}</span>
        </p>

        <nav
          className="relative z-0 inline-flex items-center space-x-1 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent max-w-full"
          aria-label="Pagination"
        >
          <button
            onClick={handlePrevious}
            disabled={currentPage === 1}
            className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 rounded-md disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95 transition-transform"
          >
            <svg
              className="h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {renderPageNumbers()}

          <button
            onClick={handleNext}
            disabled={currentPage === totalPages}
            className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 rounded-md disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95 transition-transform"
          >
            <svg
              className="h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </nav>
      </div>
    </div>
  );

};

export default Pagination;
