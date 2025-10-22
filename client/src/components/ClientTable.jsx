import React from "react";

const ClientTable = ({ data }) => {
  if (!data || data.length === 0) {
    return <p className="mt-4 text-gray-500">No client data to display.</p>;
  }

  // Assuming the data from the API is an array of objects with the same keys as the original static data.
  // If the structure is different, this will need to be adjusted.
  const clients = data;

  return (
    <div className="p-4">
      <table className="min-w-full bg-white">
        <thead>
          <tr>
            <th className="py-2 px-4 border-b">FIRST</th>
            <th className="py-2 px-4 border-b">LAST</th>
            <th className="py-2 px-4 border-b">MOBILE</th>
            <th className="py-2 px-4 border-b">EMAIL</th>
            <th className="py-2 px-4 border-b">ADDRESS</th>
            <th className="py-2 px-4 border-b">DOB</th>
            <th className="py-2 px-4 border-b">SEEN</th>
            <th className="py-2 px-4 border-b">SOURCE</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client, index) => (
            <tr key={index}>
              <td className="py-2 px-4 border-b">{client.first || ''}</td>
              <td className="py-2 px-4 border-b">{client.last || ''}</td>
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
