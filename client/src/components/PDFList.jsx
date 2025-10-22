import React from "react";

const PDFList = ({ pdfs }) => {
  return (
    <div>
      <h2>Uploaded PDFs</h2>
      <ul>
        {pdfs.map((pdf, index) => (
          <li key={index}>{pdf.name}</li>
        ))}
      </ul>
    </div>
  );
};

export default PDFList;
