// client/src/components/ClientTable.jsx
import React from "react";

const ClientTable = ({ data, isPostProcess, sortField, sortDirection, onSort }) => {
  if (!data || data.length === 0) {
    return <p className="mt-4 text-gray-500">No client data to display.</p>;
  }

  const clients = data;

  const getSortIcon = (field) => {
    if (sortField !== field) {
      return <span className="text-gray-400">↕</span>;
    }
    return sortDirection === 'asc' ? <span className="text-blue-600">↑</span> : <span className="text-blue-600">↓</span>;
  };

  const getSortableField = (displayField) => {
    // Map display fields to actual data fields
    if (isPostProcess) {
      if (displayField === 'FIRST') return 'first';
      if (displayField === 'LAST') return 'last';
    } else {
      if (displayField === 'FULL NAME') return 'full_name';
    }
    if (displayField === 'MOBILE') return 'mobile';
    if (displayField === 'EMAIL') return 'email';
    if (displayField === 'ADDRESS') return 'address';
    if (displayField === 'DOB') return 'dob';
    if (displayField === 'SEEN') return 'seen';
    if (displayField === 'SOURCE') return 'source';
    return null;
  };

  return (
    <div className="p-4">
      <table className="min-w-full bg-white">
        <thead>
          <tr>
            {isPostProcess ? (
              <>
                <th 
                  className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 select-none"
                  onClick={() => onSort('first')}
                >
                  <div className="flex items-center justify-between">
                    FIRST
                    {getSortIcon('first')}
                  </div>
                </th>
                <th 
                  className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 select-none"
                  onClick={() => onSort('last')}
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
              >
                <div className="flex items-center justify-between">
                  FULL NAME
                  {getSortIcon('full_name')}
                </div>
              </th>
            )}
            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 select-none"
              onClick={() => onSort('mobile')}
            >
              <div className="flex items-center justify-between">
                MOBILE
                {getSortIcon('mobile')}
              </div>
            </th>
            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 select-none"
              onClick={() => onSort('email')}
            >
              <div className="flex items-center justify-between">
                EMAIL
                {getSortIcon('email')}
              </div>
            </th>
            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 select-none"
              onClick={() => onSort('address')}
            >
              <div className="flex items-center justify-between">
                ADDRESS
                {getSortIcon('address')}
              </div>
            </th>
            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 select-none"
              onClick={() => onSort('dob')}
            >
              <div className="flex items-center justify-between">
                DOB
                {getSortIcon('dob')}
              </div>
            </th>
            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 select-none"
              onClick={() => onSort('seen')}
            >
              <div className="flex items-center justify-between">
                SEEN
                {getSortIcon('seen')}
              </div>
            </th>
            <th 
              className="py-2 px-4 border-b cursor-pointer hover:bg-gray-50 select-none"
              onClick={() => onSort('source')}
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
                  <td className="py-2 px-4 border-b">{client.first || ''}</td>
                  <td className="py-2 px-4 border-b">{client.last || ''}</td>
                </>
              ) : (
                <td className="py-2 px-4 border-b">{client.full_name || ''}</td>
              )}
              <td className="py-2 px-4 border-b">{client.mobile || ''}</td>
              <td className="py-2 px-4 border-b">{client.email || ''}</td>
              <td className="py-2 px-4 border-b">{client.address || ''}</td>
              <td className="py-2 px-4 border-b">{client.dob || ''}</td>
              <td className="py-2 px-4 border-b">{client.seen || ''}</td>
              <td className="py-2 px-4 border-b">{client.source || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ClientTable;
