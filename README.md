# Document Processor

This is a full-stack web application designed to process, analyze, and manage documents. The frontend is built with React and Vite, and the backend is powered by Node.js and Express.

## Features

- **Document Upload**: Upload PDF documents for processing.
- **Data Extraction**: Extracts relevant data from documents using a sophisticated processing engine.
- **Customer and Collection Management**: Organize documents by customers and collections.
- **Real-time Updates**: Uses WebSockets to provide live updates on document processing status.
- **Data Visualization**: Displays extracted data in a clean, tabular format.
- **Search and Sort**: Easily search and sort the extracted data.
- **Downloadable Reports**: Download processed data in various formats.

## Getting Started

### Prerequisites

- Node.js (v14 or later)
- npm
- A running PostgreSQL instance

### Backend Setup

1. **Navigate to the server directory:**
   ```sh
   cd server
   ```

2. **Install dependencies:**
   ```sh
   npm install
   ```

3. **Set up environment variables:**
   - Create a `.env` file in the `server` directory.
   - Add the necessary environment variables, including database credentials and any other required keys.

4. **Run the server:**
   ```sh
   node index.js
   ```

### Frontend Setup

1. **Navigate to the client directory:**
   ```sh
   cd client
   ```

2. **Install dependencies:**
   ```sh
   npm install
   ```

3. **Run the development server:**
   ```sh
   npm run dev
   ```

### Usage

1. **Create a Customer**: Use the "+ New Customer" button to create a new customer.
2. **Create a Collection**: Add a new collection for the customer.
3. **Upload Documents**: Select a collection and upload your PDF documents.
4. **View Data**: Once processing is complete, the extracted data will be displayed in the table.
5. **Manage Files**: View the status of uploaded files in the "Uploaded Document" sidebar.

## Project Structure

- **/client**: Contains the React frontend application.
- **/server**: Contains the Node.js backend application.
- **Other files**: Configuration and script files for deployment and local development.
