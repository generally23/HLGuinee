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
