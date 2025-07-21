# Mapping Recent Canadian Federal Elections -- Web Viewer
- by Mark Fruman mark.fruman@yahoo.com


- Static web page written in HTML / CSS / javascript for viewing data processed with [canada-votes](https://www.github.com/majorgowan/canada-votes/) python library
- Provisionally deployed [here](http://canadavotes.s3-website-us-west-2.amazonaws.com/index.html)


### Deployment
- To reproduce, data files generated with [`canadavotes.webutils.write_leaflet_data()`](https://github.com/majorgowan/canada-votes/blob/master/webutils.py)
should be placed in `resources/data` folder and be on the form `leaflet_data_[type]_[city]_[election_year].json` where `[type]` is one of
`eday` or `advance`.
- Simple deployment locally for testing with (for example)
```
python -m http.server [port]
```



## References:
#### Companion python project
- https://www.github.com/majorgowan/canada-votes

#### Leaflet javascript library
- https://leafletjs.com/