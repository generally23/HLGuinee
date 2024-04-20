// Select the database to use.
use('houses&lands');

const searchStage = {
  $search: {
    index: 'main_search',
    text: {
      query: 'luxe',
      path: ['title', 'description', 'tags', 'address'],
    },
  },
};

db.properties.updateOne(
  { _id: ObjectId('652709af103c91372fab83fb') },
  { $set: { 'location.coordinates': [-13.516692405831321, 9.788094124928804] } }
);

const pipeline = [
  searchStage,

  // {
  //   $matc
  // }

  {
    $sort: {
      price: 1,
    },
  },

  {
    $skip: 1,
  },

  { $limit: 1 },

  {
    $project: {
      title: 1,
      _id: 0,
      price: 1,
    },
  },
];

const countPipeline = [
  searchStage,
  {
    $count: 'total',
  },
];

db.properties.aggregate(pipeline);

// db.properties.aggregate(countPipeline);

[
  {
    $search: {
      index: 'main_search',
      compound: [
        {
          geoWithin: {
            path: 'location',
            box: {
              bottomLeft: {
                type: 'Point',
                coordinates: [-15.230412450491485, 7.106619720488965],
              },
              topRight: {
                type: 'Point',
                coordinates: [-12.407502186869351, 11.675722851192958],
              },
            },
          },
        },
        {
          sort: {
            title: -1,
          },
        },
      ],
    },
  },
  {
    $skip: 11,
  },

  {
    $limit: 5,
  },

  {
    $project: {
      _id: 1,
      price: 1,
    },
  },
];

[
  {
    $search: {
      index: 'main_search',
      geoWithin: {
        path: 'location',
        box: {
          bottomLeft: {
            type: 'Point',
            coordinates: [-15.230412450491485, 7.106619720488965],
          },
          topRight: {
            type: 'Point',
            coordinates: [-12.407502186869351, 11.675722851192958],
          },
        },
      },
    },
  },

  { $sort: { title: -1, _id: -1 } },

  {
    $skip: 0,
  },

  {
    $limit: 5,
  },

  {
    $project: {
      _id: 1,
    },
  },
];
