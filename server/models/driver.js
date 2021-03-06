const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Message = require("./message");
const Communications = require("../services/communications");
const { getAddressString } = require("../services/location");
const { ObjectId } = mongoose.Schema.Types;

const driverSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, "Email is required."],
    unique: true,
    index: true,
    maxlength: 64,
  },
  emailIsConfirmed: { type: Boolean, default: false },
  password: {
    type: String,
    required: [true, "password is required."],
    maxlength: 128,
  },
  firstName: { type: String, maxlength: 64 },
  lastName: { type: String, maxlength: 64 },
  phoneNumber: { type: String },
  createdOn: { type: Date, default: Date.now },
  visits: [{ type: Date }],
  lastVisited: { type: Date, default: Date.now },
  orderHistory: [{ type: ObjectId, ref: "Order" }],
  online: Boolean,
  latitude: Number,
  longitude: Number,
  status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "INACTIVE" },
  deviceTokens: [String],
  emailSettings: { type: Object, default: {} },
  notificationSettings: {
    type: Object,
    default: { REQUEST_DRIVER: true, CHAT: true },
  },
  orders: [{ type: ObjectId, ref: "Order" }],
});

driverSchema.methods.validatePassword = async function (password) {
  return await bcrypt.compare(this.password, password);
};

driverSchema.methods.sendEmail = async function ({
  setting,
  subject,
  text,
  html,
}) {
  try {
    if (this.emailSettings[setting] || setting === "ACCOUNT") {
      return await Communications.sendMail({
        to: this.email,
        subject,
        text,
        html,
      });
    } else
      return {
        error: {
          message: `Driver has turned off email setting: ${setting}`,
          status: 200,
        },
      };
  } catch (error) {
    const errorString = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error)
    );
    return { error: { errorString, functionName: "sendEmail", status: 200 } };
  }
};

driverSchema.methods.sendMessage = async function ({
  setting,
  title,
  body,
  data,
  senderId,
  senderModel,
}) {
  try {
    if (setting && this.notificationSettings[setting]) {
      const message = new Message({
        messageType: data.messageType,
        recipient: this._id,
        recipientModel: "Driver",
        sender: senderId,
        senderModel,
        title,
        body,
        data,
        deviceTokens: this.deviceTokens,
      });
      return await message.save();
    }
    return {
      error: {
        message: `Driver has turned off notification setting: ${setting}`,
        status: 200,
      },
    };
  } catch (error) {
    const errorString = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error)
    );
    return { error: { errorString, functionName: "sendMessage", status: 200 } };
  }
};

driverSchema.methods.toggleStatus = async function (status) {
  if (this.orders.length && status === "INACTIVE") {
    return {
      error: {
        message: "There are still active orders on your route!",
        functionName: "toggleStatus",
        status: 418,
      },
    };
  }
  this.status = status;
  await this.save();
  return this.status;
};

driverSchema.methods.addDeviceToken = async function (deviceToken) {
  this.deviceTokens.pull(deviceToken);
  this.deviceTokens.push(deviceToken);
  await this.save();
  return this;
};

driverSchema.methods.requestDriver = async function (order) {
  try {
    if (order.driver) {
      return { error: { message: "Order already has a driver assigned." } };
    }
    if (this.orders.length) {
      await this.populate("orders").execPopulate();
      if (this.orders[0].vendor !== order.vendor) {
        return {
          error: {
            message: "Driver is currently delivering for another vendor.",
          },
        };
      }
    }
    if (this.status === "INACTIVE") {
      return {
        error: { message: "Driver is offline." },
      };
    }
    await order.populate("vendor customer address").execPopulate();
    const { vendor, customer } = order;
    const title = "Incoming Order!";
    const body = `New order from ${vendor.businessName}.`;
    const data = {
      orderId: order._id.toString(),
      messageType: "REQUEST_DRIVER",
      openModal: "true",
      businessName: vendor.businessName,
      customerName: `${customer.firstName} ${customer.lastName[0]}`,
      businessAddress: getAddressString(vendor.address),
      customerAddress: getAddressString(order.address),
      tip: order.tip.toString(),
    };
    return await this.sendMessage({
      setting: "REQUEST_DRIVER",
      title,
      body,
      data,
      senderId: vendor._id,
      senderModel: "Vendor",
    });
  } catch (error) {
    const errorString = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error)
    );
    return { error: { errorString, functionName: "requestDriver" } };
  }
};

driverSchema.methods.notifyOrderReady = async function ({ vendor, order }) {
  try {
    await this.sendMessage({
      setting: "REQUEST_DRIVER",
      title: `Order up!`,
      body: `The order at ${vendor.businessName} is ready.`,
      data: {
        orderId: order._id.toString(),
        messageType: "ORDER_READY",
        openModal: "false",
      },
      senderId: vendor._id,
      senderModel: "Vendor",
    });
  } catch (error) {
    const errorString = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error)
    );
    return { error: { errorString, functionName: "notifyOrderReady" } };
  }
};

driverSchema.methods.notifyOrderCanceled = async function ({ vendor, order }) {
  try {
    await this.sendMessage({
      setting: "REQUEST_DRIVER",
      title: "Order canceled.",
      body: `The order for ${vendor.businessName} has been canceled.`,
      data: {
        orderId: order._id.toString(),
        messageType: "ORDER_CANCELED",
        openModal: "false",
      },
      senderId: vendor._id,
      senderModel: "Vendor",
    });
  } catch (error) {
    const errorString = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error)
    );
    return { error: { errorString, functionName: "notifyOrderCanceled" } };
  }
};

module.exports = mongoose.model("Driver", driverSchema);
