const express = require('express');
const app = express()
const cors = require('cors');
const dotenv = require('dotenv');
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion } = require('mongodb');


//middleware
dotenv.config()
app.use(cors())
app.use(express.json())



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.qwhtqkb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


const run = async() =>{
    try{
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        console.log('ping');
    }
    finally{

    }
}

run().catch(console.dir)

app.get('/', (req, res) =>{
    res.send('Welcome To Pro Fast Server')
})

app.listen(port, () =>{
    console.log(`the server is running on port ${port}`);
})