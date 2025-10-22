import React from "react";

const clients = [
  { first: "A", last: "White", mobile: "0401 288 575", email: "a.white@live.com.au", address: "603 Pacific Highway WYOMING NSW 2250", dob: "Apr 8, 1988", seen: "Jun 30, 2023", source: "Page 2.pdf" },
  { first: "A", last: "White", mobile: "0401 288 575", email: "a.white@live.com.au", address: "603 Pacific Highway WYOMING NSW 2250", dob: "Apr 8, 1988", seen: "Jun 30, 2023", source: "Page 2.pdf" },
  { first: "A", last: "Mahony", mobile: "0408 407 665", email: "-", address: "38 Joyce Avenue WYOMING NSW 2250", dob: "Aug 26, 1946", seen: "May 2, 2024", source: "Page 16.pdf" },
  { first: "Gordon", last: "A", mobile: "0410 982 008", email: "alg72@bigpond.com", address: "17 Georgia Avenue WYOMING NSW 2250", dob: "Jul 5, 1972", seen: "Aug 9, 2025", source: "Page 21.pdf" },
  { first: "A", last: "Nelson", mobile: "0411 792 726", email: "-", address: "6 Belina Avenue WYOMING NSW 2250", dob: "Oct 6, 1964", seen: "Jul 25, 2025", source: "Page 23.pdf" },
];

const ClientTable = () => {
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
              <td className="py-2 px-4 border-b">{client.first}</td>
              <td className="py-2 px-4 border-b">{client.last}</td>
              <td className="py-2 px-4 border-b">{client.mobile}</td>
              <td className="py-2 px-4 border-b">{client.email}</td>
              <td className="py-2 px-4 border-b">{client.address}</td>
              <td className="py-2 px-4 border-b">{client.dob}</td>
              <td className="py-2 px-4 border-b">{client.seen}</td>
              <td className="py-2 px-4 border-b">{client.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ClientTable;
