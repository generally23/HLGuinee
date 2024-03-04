import { objectAssign } from './utils';

export default class ServerQuery {
  constructor(Model, clientQuery) {
    if (!Model || !clientQuery)
      throw new Error('Please make sure query and clientQuery are provided');

    const { search = '' } = clientQuery;

    this.search = clientQuery.search = '';
    this.sortBy = clientQuery.sortBy = '';
    this.page = clientQuery.page || 1;
    this.limit = clientQuery.limit || 15;
    this.fields = clientQuery.fields.split(' ').join('');

    /* {
         search: 'test',
         page: 1,
         limit: 10,
         sortBy: 'title'
         type: 'house'
         rooms: 5
    } */

    this.filters = () => {};

    this.clientQuery = clientQuery;
  }

  // search for data
  search() {
    // get search term
    const { search } = this.clientQuery;

    console.log(search);

    // if client is not searching for something return the query
    if (!search) return this;

    // create search query from search term
    const searchQuery = { $text: { $search: search } };

    // return the query
    return this.query.find(searchQuery);
  }

  // apply filters
  filter() {
    // get known filters
    const {
      type,
      rooms,
      published,
      externalBathrooms,
      internalBathrooms,
      hasCuisine,
      hasGarage,
      hasDiningRoom,
      hasLivingRoom,
      fenced,
      hasPool,
      price,
      yearBuilt,
    } = this.clientQuery;

    const filterObject = {};

    // create a geoFilter query
    const geoFilter = {
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
          // $maxDistance: radius,
        },
      },
    };
  }

  // sort data
  sort() {
    // get string to sort by (title, -tile, etc...)
    const { sortBy } = this.clientQuery;

    // return the query if sort is not specified
    if (!sortBy) return this;

    return this.query.sort(sortBy);
  }

  // paginate data
  paginate() {}
}
