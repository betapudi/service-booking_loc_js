// backend/routes/osrm-route.js
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const polyline = require('polyline');
const { authMiddleware } = require('../helpers/auth');

const OSRM_SERVER = process.env.OSRM_SERVER || 'http://router.project-osrm.org';

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { start_lat, start_lon, end_lat, end_lon } = req.query;

    // Validate coordinates
    if (!start_lat || !start_lon || !end_lat || !end_lon) {
      return res.status(400).json({
        error: 'Missing coordinates. Required: start_lat, start_lon, end_lat, end_lon'
      });
    }

    // Fetch route from OSRM
    const response = await fetch(
      `${OSRM_SERVER}/route/v1/driving/` +
      `${start_lon},${start_lat};${end_lon},${end_lat}` +
      '?overview=full&geometries=polyline'
    );

    if (!response.ok) {
      throw new Error(`OSRM server responded with ${response.status}`);
    }

    const data = await response.json();

    if (!data.routes || !data.routes[0]) {
      return res.status(404).json({ error: 'No route found' });
    }

    // Extract useful information
    const route = data.routes[0];

    const geoJson = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: route.geometry ? polyline.decode(route.geometry).map(([lat, lng]) => [lng, lat]) : []
      },
      properties: {
        distance: route.distance,
        duration: route.duration
      }
    };

    res.json({
      geojson: geoJson,
      distance: route.distance,
      duration: route.duration
    });

  } catch (error) {
    console.error('OSRM Route Error:', error);
    res.status(500).json({
      error: 'Failed to fetch route',
      details: error.message
    });
  }
});

module.exports = router;
