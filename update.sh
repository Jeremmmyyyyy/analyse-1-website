#!/usr/bin/env bash

echo "Updating analyse-1-website..."

echo "Removing old files..."
rm /storage/web/js/*

echo "Copying new files..."
cp /storage/analyse-1-website/dist/js/* /storage/web/js

echo "Update complete."