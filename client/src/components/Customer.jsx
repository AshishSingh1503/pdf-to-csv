import React from "react";

const Customer = ({ customer }) => {
  return (
    <div>
      {customer && (
        <div>
          <h2>Customer Information</h2>
          <p>Name: {customer.name}</p>
          <p>Email: {customer.email}</p>
        </div>
      )}
    </div>
  );
};

export default Customer;
