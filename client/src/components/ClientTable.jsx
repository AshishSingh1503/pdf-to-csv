// client/src/components/ClientTable.jsx
import React from "react";
import EmptyState from './EmptyState'

const ClientTable = ({ data, isPostProcess, sortField, sortDirection, onSort }) => {
  if (!data || data.length === 0) {
    return (
      <EmptyState icon="📋" title="No client data to display" description="Upload PDF files to see processed data here" />
    )
  }

  const clients = data;

  const getSortIcon = (field) => {
    if (sortField !== field) {
      return <span className="text-slate-400 dark:text-slate-400">⇅</span>;
    }
    return sortDirection === 'asc' ? <span className="text-sky-500">↑</span> : <span className="text-sky-500">↓</span>;
  };

  const handleHeaderKey = (e, field) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSort(field)
    }
  }

  return (
    <div className="p-4 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded shadow-sm">
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="min-w-[800px] bg-white dark:bg-transparent">
        <thead>
          <tr>
            {isPostProcess ? (
              <>
                <th
                  className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 select-none border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                  onClick={() => onSort('full_name')}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => handleHeaderKey(e, 'full_name')}
                  aria-sort={sortField === 'full_name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  title="Click to sort by full name"
                >
                  <div className="flex items-center justify-between">
                    FULL NAME
                    {getSortIcon('full_name')}
                  </div>
                </th>
                <th
                  className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 select-none border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                  onClick={() => onSort('first')}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => handleHeaderKey(e, 'first')}
                  aria-sort={sortField === 'first' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  title="Click to sort by first"
                >
                  <div className="flex items-center justify-between">
                    FIRST
                    {getSortIcon('first')}
                  </div>
                </th>
                <th
                  className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 select-none border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                  onClick={() => onSort('last')}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => handleHeaderKey(e, 'last')}
                  aria-sort={sortField === 'last' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  title="Click to sort by last"
                >
                  <div className="flex items-center justify-between">
                    LAST
                    {getSortIcon('last')}
                  </div>
                </th>
              </>
            ) : (
              <th
                className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 select-none"
                onClick={() => onSort('full_name')}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => handleHeaderKey(e, 'full_name')}
                aria-sort={sortField === 'full_name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                title="Click to sort by full name"
              >
                <div className="flex items-center justify-between">
                  FULL NAME
                  {getSortIcon('full_name')}
                </div>
              </th>
            )}

            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 select-none border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              onClick={() => onSort('dob')}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => handleHeaderKey(e, 'dob')}
              aria-sort={sortField === 'dob' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              title="Click to sort by DOB"
            >
              <div className="flex items-center justify-between">
                DOB
                {getSortIcon('dob')}
              </div>
            </th>

            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 select-none border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              onClick={() => onSort('address')}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => handleHeaderKey(e, 'address')}
              aria-sort={sortField === 'address' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              title="Click to sort by address"
            >
              <div className="flex items-center justify-between">
                ADDRESS
                {getSortIcon('address')}
              </div>
            </th>
            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 select-none border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              onClick={() => onSort('mobile')}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => handleHeaderKey(e, 'mobile')}
              aria-sort={sortField === 'mobile' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              title="Click to sort by mobile"
            >
              <div className="flex items-center justify-between">
                MOBILE
                {getSortIcon('mobile')}
              </div>
            </th>
            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 select-none border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              onClick={() => onSort('email')}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => handleHeaderKey(e, 'email')}
              aria-sort={sortField === 'email' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              title="Click to sort by email"
            >
              <div className="flex items-center justify-between">
                EMAIL
                {getSortIcon('email')}
              </div>
            </th>
            
            
            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 select-none border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              onClick={() => onSort('lastseen')}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => handleHeaderKey(e, 'lastseen')}
              aria-sort={sortField === 'lastseen' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              title="Click to sort by last seen"
            >
              <div className="flex items-center justify-between">
                SEEN
                {getSortIcon('lastseen')}
              </div>
            </th>
            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 select-none border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
              onClick={() => onSort('source')}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => handleHeaderKey(e, 'source')}
              aria-sort={sortField === 'source' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              title="Click to sort by source"
            >
              <div className="flex items-center justify-between">
                SOURCE
                {getSortIcon('source')}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client, index) => (
            <tr key={index}>
              {isPostProcess ? (
                <>
                  <td className="py-2 px-4 border-b border-gray-200 dark:border-slate-700">{client.full_name || ''}</td>
                  <td className="py-2 px-4 border-b border-gray-200 dark:border-slate-700">{client.first || ''}</td>
                  <td className="py-2 px-4 border-b border-gray-200 dark:border-slate-700">{client.last || ''}</td>
                </>
              ) : (
                <td className="py-2 px-4 border-b border-gray-200 dark:border-slate-700">{client.full_name || ''}</td>
              )}
              <td className="py-2 px-4 border-b border-gray-200 dark:border-slate-700">{client.dob || ''}</td>
              <td className="py-2 px-4 border-b border-gray-200 dark:border-slate-700">{client.address || ''}</td>
              <td className="py-2 px-4 border-b border-gray-200 dark:border-slate-700">{client.mobile || ''}</td>
              <td className="py-2 px-4 border-b border-gray-200 dark:border-slate-700">{client.email || ''}</td>
              <td className="py-2 px-4 border-b border-gray-200 dark:border-slate-700">{client.seen || ''}</td>
              <td className="py-2 px-4 border-b border-gray-200 dark:border-slate-700">{client.source || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
};

export default ClientTable;
