const express = require("express");
const app = express();
const cors = require("cors");
const dotenv = require("dotenv");
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

//middleware
dotenv.config();
app.use(cors());
app.use(express.json());
const stripe = require("stripe")(process.env.PAYMENT_GETAWAY_KEY);

const serviceAccount = require("./firebase_admin_key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.qwhtqkb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const run = async () => {
  try {
    await client.connect();

    const db = client.db("pro-fast");
    const parcelCollection = db.collection("parcels");
    const paymentHistoryCollection = db.collection("payments");
    const trackingCollection = db.collection("tracking");
    const userCollection = db.collection("users");
    const ridersCollection = db.collection("riders");

    //custom middleware

    const verifyFbToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(" ")[1];

      //verify
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    const verifyAdmin = async(req, res, next) =>{
       const email = req.decoded.email;
       const user = await userCollection.findOne({email});

       if(!user || user.role !== 'admin'){
        return res.status(403).send({message: 'forbidden access'})
       }
       next();
    }

    //user related api's

    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const existingUser = await userCollection.findOne({ email });
      if (existingUser) {
        return res
          .status(200)
          .send({ message: "user already exist", inserted: false });
      }
      const newUser = req.body;
      const result = await userCollection.insertOne(newUser);
      res.send(result);
    });

    app.get('/users/search', verifyFbToken, async(req, res) =>{
      const emailQuery = req.query.email;
      if(!emailQuery){
        return res.status(400).send({message:'email is missing'})
      }

      const regex = new RegExp(emailQuery, 'i') // case insensitive partial match
      const result = await userCollection
      .find({email: {$regex:regex}})
      .project({email: 1, created_at:1, role: 1})
      .limit(10)
      .toArray()

      res.send(result)
    })

    app.get('/users/:email/role', verifyFbToken, async(req, res) =>{
      const email = req.params.email;
      if(!email){
        return res.status(400).send({message: 'email is required'})
      }

      const user = await userCollection.findOne({email})
      
      if(!user){
        return res.status(400).send({message: 'user not found'})
      }

      res.send({role: user.role || 'user'})
    })

    app.patch('/users/:id/role', verifyFbToken, verifyAdmin, async(req, res) =>{
      const {id} = req.params;
      const {role} = req.body;

      // if(!['admin', 'user'].includes(role)){
      //   return res.status(400).send({message: 'invalid role'})
      // }

      const result = await userCollection.updateOne(
        {_id: new ObjectId(id)},
        {$set: {role}}
      )
      res.send(result)
    })

    //parcels api's
    app.post("/parcels", verifyFbToken, async (req, res) => {
      const newParcel = req.body;
      const result = await parcelCollection.insertOne(newParcel);
      res.send(result);
    });

    // app.get("/parcels", async (req, res) => {
    //   const result = await parcelCollection.find().toArray();
    //   res.send(result);
    // });

    app.get("/parcels/:id", verifyFbToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    app.get("/parcels", verifyFbToken, async (req, res) => {
      const userEmail = req.query.email;

      // console.log(req);

      const query = userEmail ? { created_by: userEmail } : {};
      const options = {
        sort: { creation_date: -1 },
      };
      const parcels = await parcelCollection.find(query, options).toArray();
      res.send(parcels);
    });


    app.get('/parcel/assignable', verifyFbToken, verifyAdmin, async(req, res) =>{
      const query = {
        payment_status: 'Paid',
        delivery_status:'Not Collected'
      }
      const result = await parcelCollection.find(query).toArray()
      res.send(result)
    })

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    //payment api
    app.post("/create-payment-intent", verifyFbToken, async (req, res) => {
      const amountInCents = req.body.amountInCents;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.json({ clientSecret: paymentIntent.client_secret });
    });

    // payment record and update parcel status
    app.post("/payments", async (req, res) => {
      try {
        const {
          parcelId,
          userEmail,
          amount,
          paymentMethod,
          transactionId,
          paymentDate = new Date().toISOString(),
        } = req.body;

        // 1. Update parcel payment status
        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId), created_by: userEmail },
          {
            $set: {
              payment_status: "Paid",
            },
          }
        );

        if (updateResult.matchedCount === 0) {
          return res
            .status(404)
            .json({ error: "Parcel not found or unauthorized" });
        }

        // 2. Insert payment history record
        const historyDoc = {
          parcelId: new ObjectId(parcelId),
          userEmail,
          amount,
          paymentMethod,
          transactionId: transactionId || null,
          paymentDate: new Date(paymentDate),
        };

        const insertResult = await paymentHistoryCollection.insertOne(
          historyDoc
        );

        res.json({
          message: "Payment confirmed and history saved",
          paymentHistoryId: insertResult.insertedId,
        });
      } catch (error) {
        console.error("Payment confirmation error:", error);
        res.status(500).json({ error: "Server error" });
      }
    });

    app.get("/payments", verifyFbToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        if (req.decoded.email !== userEmail) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const query = userEmail ? { userEmail } : {};
        const options = {
          sort: { paymentDate: -1 }, // newest first
        };

        const history = await paymentHistoryCollection
          .find(query, options)
          .toArray();

        res.send(history);
      } catch (error) {
        console.error("Payment history fetch error:", error);
        res.status(500).json({ error: "Server error" });
      }
    });

    //tracking api's
    app.post("/tracking", async (req, res) => {
      const {
        tracking_id,
        parcel_id,
        status,
        message,
        updated_by = "",
      } = req.body;
      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
        status,
        message,
        time: new Date(),
        updated_by,
      };
      const result = await trackingCollection.insertOne(log);
      res.send(result);
    });

    //riders api's

    app.post("/riders", verifyFbToken, async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.get("/riders/pending", verifyFbToken, verifyAdmin, async (req, res) => {
      const pendingRiders = await ridersCollection
        .find({ status: "Pending" })
        .toArray();
      res.send(pendingRiders);
    });

    app.patch("/riders/:id/status", async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;

      const result = await ridersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      //updating user role after accepting as rider
      if(status === 'active'){
        const userQuery = {email};
        const updatedDoc = {
          $set:{
            role: 'rider'
          }
        }
        const userResult = await userCollection.updateOne(userQuery, updatedDoc)
        // console.log(userResult.modifiedCount);
      }

      res.send(result);
    });

    app.get("/riders/active", verifyFbToken, verifyAdmin, async (req, res) => {
      const result = await ridersCollection
        .find({ status: "active" })
        .toArray();
      res.send(result);
    });

    app.delete("/riders/:id", async (req, res) => {
      const id = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await ridersCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/riders/deactivated", verifyFbToken, verifyAdmin, async (req, res) => {
      const result = await ridersCollection
        .find({ status: "deactivate" })
        .toArray();
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log("ping");
  } finally {
  }
};

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Welcome To Pro Fast Server");
});

app.listen(port, () => {
  console.log(`the server is running on port ${port}`);
});
