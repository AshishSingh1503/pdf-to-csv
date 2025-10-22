import React from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import ClientTable from "../components/ClientTable";
import Pagination from "../components/Pagination";
import Footer from "../components/Footer";

const Home = () => {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <ClientTable />
        </main>
        <Footer />
        <Pagination />
      </div>
    </div>
  );
};

export default Home;
