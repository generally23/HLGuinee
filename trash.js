// export const paginateModel = async (
//   Model,
//   searchObject = {},
//   filterObject = {},
//   sortStr = '',
//   /* paging info */ { page, limit },
//   // all these must be populated
//   ...populates
// ) => {
//   // variables
//   let docs;
//   let docsCount;
//   let query;
//   let matches;
//   let matchesIds;
//   // find documents length
//   const searchObjectLength = Object.values(searchObject).length;

//   if (searchObjectLength) {
//     matches = await Model.find(searchObject);
//     matchesIds = matches.map(match => match._id);

//     const documents = await Model.find({
//       _id: { $in: matchesIds },
//       ...filterObject,
//     });

//     docsCount = documents.length;
//   } else {
//     // we didn't use countDocuments here because it doesn't support $nearSphere
//     const documents = await Model.find(filterObject);
//     docsCount = documents.length;
//   }

//   // get paging info
//   page = Number(page);
//   limit = Number(limit);

//   // sanitize user input
//   if (isNaN(page) || page < 1) page = 1;

//   if (isNaN(limit) || limit < 15) limit = 15;

//   let firstPage = 1;
//   let pages = Math.ceil(docsCount / limit);
//   let lastPage = pages;

//   const prevPage = firstPage < page ? page - 1 : null;
//   const nextPage = lastPage > page ? page + 1 : null;

//   const read = page - firstPage;
//   const toread = lastPage - page;

//   const skip = (page - 1) * limit;

//   if (searchObjectLength) {
//     query = Model.find({ _id: { $in: matchesIds }, ...filterObject })
//       .sort(sortStr)
//       .skip(skip)
//       .limit(limit);

//     populates.forEach(population => query.populate(population));

//     docs = await query;
//   } else {
//     query = Model.find(filterObject).sort(sortStr).skip(skip).limit(limit);

//     populates.forEach(population => query.populate(population));

//     docs = await query;
//   }

//   const docsLength = docs.length;

//   console.log('Total Results: ', docsCount);

//   return {
//     page,
//     pageCount: pages,
//     pages: createPages(pages),
//     nextPage,
//     prevPage,
//     read,
//     toread,
//     docs,
//     totalResults: docsCount,
//     firstPage,
//     lastPage,
//     docsLength,
//   };
// };

// create pages array out of a number of pages
// const createPages = numPages => {
//     let firstPage = 1;
//     const pages = [];
//     for (let i = firstPage; i <= numPages; i++) {
//       pages.push(i);
//     }
//     return pages;
//   };

// export const isNearGuinea = coordinates => {
//     if (!coordinates || coordinates.length !== 2) return false;

//     const place = point(coordinates);

//     const area = polygon([
//       [
//         [-15.1303112452, 7.3090373804],
//         [-7.83210038902, 7.3090373804],
//         [-7.83210038902, 12.5861829696],
//         [-15.1303112452, 12.5861829696],
//         [-15.1303112452, 7.3090373804],
//       ],
//     ]);

//     return booleanPointInPolygon(place, area);
//   };

// export const fetchProperties = catchAsyncErrors(async (req, res, next) => {
//     console.log('Request Query: ', req.query);
//     // latitude of client
//     const latitude = parseFloat(req.headers.latitude);
//     // longitude of client
//     const longitude = parseFloat(req.headers.longitude);
//     // radius is in km convert it to meters 1km => 1000m
//     const radius = parseInt(req.headers.radius) * 1000 || 10_000;

//     console.log('Lng: ', longitude, 'Lat: ', latitude, 'Radius: ', radius);

//     // this filter finds properties near a given client location
//     const geoFilter = {
//       location: {
//         $nearSphere: {
//           $geometry: { type: 'Point', coordinates: [longitude, latitude] },
//           // $maxDistance: radius,
//         },
//       },
//     };

//     const { search, type, documented, page = 1, limit = 100 } = req.query;
//     // object containg search query
//     const searchObject = {};
//     // search query
//     const searchQuery = { $text: { $search: search } };
//     // only assign search query to search object when present
//     search && objectAssign(searchQuery, searchObject);
//     // contains all filters
//     const filterObject = {};
//     // only try finding properties near location if longitude and latitude is present
//     longitude && latitude && objectAssign(geoFilter, filterObject);

//     // assign if present
//     objectAssign({ type, documented }, filterObject);

//     // contains sorting
//     let { sortBy } = req.query;

//     // contains pagination info
//     const pagination = { page, limit };
//     // paginate data

//     const data = await paginateModel(
//       Property,
//       searchObject,
//       filterObject,
//       sortBy,
//       pagination,
//       'owner'
//     );

//     res.json(data);
//   });

// export const buildSearchStage = (
//     searchTerm,
//     { longitude, latitude, northEastBounds, southWestBounds }
//   ) => {
//     console.log('northEastBounds', northEastBounds);
//     console.log('southWestBounds', southWestBounds);

//     const index = 'main_search';
//     // check to see if the user is inside guinea's bounding box
//     const isGeoSearchAllowed = longitude && latitude;

//     // search stage
//     const searchStage = { $search: { index } };

//     // text search query
//     const textQuery = {
//       query: searchTerm,
//       path: ['title', 'tags', 'description', 'address'],
//       fuzzy: {},
//     };

//     // geo search query
//     const geoQuery = {
//       path: 'location',
//       box: {
//         bottomLeft: {
//           type: 'Point',
//           coordinates: southWestBounds,
//         },
//         topRight: {
//           type: 'Point',
//           coordinates: northEastBounds,
//         },
//       },
//     };

//     // user has not serched for anything and they're not allowed to geo search
//     if (!searchTerm && !isGeoSearchAllowed) return;

//     // user is text and geo searching
//     if (searchTerm && isGeoSearchAllowed) {
//       // text clause
//       const textClause = { text: textQuery };
//       // geo clause
//       const geoClause = { geoWithin: geoQuery };
//       // create a compound operator that geo search 1st
//       searchStage.$search.compound = { must: [geoClause, textClause] };
//     }

//     // user is only text searching
//     if (searchTerm && !isGeoSearchAllowed) searchStage.$search.text = textQuery;

//     // user is only geo searching
//     if (!searchTerm && isGeoSearchAllowed)
//       searchStage.$search.geoWithin = geoQuery;

//     // return built search stage based on above scenarios
//     return searchStage;
//   };
