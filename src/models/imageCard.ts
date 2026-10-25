import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IImageCard extends Document {
  code: string;
  imageUrl: string;
  level?: number;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}

const imageCardSchema = new Schema<IImageCard>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    level: {
      type: Number,
      required: true,
      default: 1,
      index: true,
    },
    title: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const ImageCard: Model<IImageCard> = mongoose.model<IImageCard>(
  "ImageCard",
  imageCardSchema,
  "imagecards"
);

export default ImageCard;
