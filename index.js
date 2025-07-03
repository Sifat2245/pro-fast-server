const express = require("express");
const app = express();
const cors = require("cors");
const dotenv = require("dotenv");
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

//middleware
dotenv.config();
app.use(cors());
app.use(express.json());
const stripe = require("stripe")(process.env.PAYMENT_GETAWAY_KEY);

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

    //parcels api's
    app.post("/parcels", async (req, res) => {
      const newParcel = req.body;
      const result = await parcelCollection.insertOne(newParcel);
      res.send(result);
    });

    app.get("/parcels", async (req, res) => {
      const result = await parcelCollection.find().toArray();
      res.send(result);
    });
    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    app.get("/parcels", async (req, res) => {
      const userEmail = req.query.email;

      const query = userEmail ? { created_by: userEmail } : {};
      const options = {
        sort: { creation_date: -1 },
      };
      const parcels = await parcelCollection.find(query, options).toArray();
      res.send(parcels);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    //payment api
    app.post("/create-payment-intent", async (req, res) => {
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

    app.get("/payments", async (req, res) => {
      try {
        const { userEmail } = req.query;
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
