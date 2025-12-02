#!/usr/bin/env bash

echo "Updating analyse-1-website..."

echo "Removing old files..."
rm /storage/web/js/*
rm -rf /storage/web/css/*

echo "Copying new files..."
cp /storage/analyse-1-website/dist/js/* /storage/web/js
cp -r /storage/analyse-1-website/dist/css/* /storage/web/css

echo "Update complete."