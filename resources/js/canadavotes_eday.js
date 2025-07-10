// based on Leaflet tutorial
// https://leafletjs.com/examples/choropleth/

document.addEventListener("DOMContentLoaded", function() {

    // for local data storage served by host on port 3099
    // var dataurl = "http://localhost:3099//resources/data/";
    // relative path
    var dataurl = "/resources/data/";
    // note s3 bucket permission set with policy
    //   {
    //       "Version": "2012-10-17",
    //       "Statement": [
    //           {
    //               "Sid": "AddPerm",
    //               "Effect": "Allow",
    //               "Principal": "*",
    //               "Action": "s3:GetObject",
    //               "Resource": "arn:aws:s3:::canadavotes/*"
    //           }
    //       ]
    //   }

    // instantiate map object and controls
    var map = L.map('canadavotes_map');
    var info = L.control();
    var legend = L.control({position: 'bottomright'});

    // declare variables before refresh function to avoid
    // unnecessary fetching of data when it hasn't changed
    var city;
    var year;
    var leaflet_data;

    const cvForm = document.getElementById("cv_control_panel_form");

    // when refresh button clicked
    const cvRefreshButton = cvForm.querySelector("#cv_refresh_button");
    cvRefreshButton.addEventListener("click", function() {
        // make map div visible
        document.getElementById("leaflet-wrapper").style.display = "block";
        refresh_form(cvForm);
    });

    function refresh_form(form) {

        var city1 = form.querySelector('input[name="metro-area-radio"]:checked').value;
        var year1 = form.querySelector('input[name="election-year-radio"]:checked').value;
        var party1 = form.querySelector("#cv_party1_selector").value;
        var party2 = form.querySelector("#cv_party2_selector").value;

        if (!["north_toronto", "downtown_toronto", "south_ottawa",
              "southwest_calgary", "surrey_burnaby"].includes(city1)) {
            city1 = "north_toronto";
        }
        if (!["2008", "2011", "2015",
              "2019", "2021"].includes(year1)) {
            year1 = "2021";
        }

        // load the data if city or year has changed
        if (city1 != city || year1 != year) {
            city = city1;
            year = year1;
            Promise.all([
                d3.json(dataurl + "leaflet_data_eday_" + city
                        + "_" + year + ".json")
            ]).then(
                function([new_leaflet_data]) {
                    // console.log("are you READY?!");
                    leaflet_data = new_leaflet_data;
                    main(leaflet_data, city, [party1, party2], year);
                }
            );
        } else {
            // don't need to reload the data
            main(leaflet_data, city, [party1, party2], year);
        }
    }

    function main(data, city, parties, year) {
        // console.log("data loaded!");

        const colourmap = {
            "Conservative": "blue",
            "Liberal": "red",
            "NDP-New Democratic Party": "orange",
            "Green Party": "green",
            "Communist": "darkred",
            "People's Party - PPC": "orchid",
            "Bloc Québécois": "lightblue"
        };

        function get_voteshare(feature, party) {
            if (party in feature.properties) {
                return (
                    feature.properties[party]["eday"]
                    / feature.properties["TotalVotes"]["eday"]
                );
            } else {
                return 0;
            }
        }

        // compute maximum fraction for each party
        var party_max = [0.0, 0.0];
        // party_diff_max is for color scale (set minmax to 5%)
        var party_diff_max = [0.05, 0.05];
        for (fednum in data.polldata) {
            for (feature of data.polldata[fednum].votes.features) {
                const voteshare0 = get_voteshare(feature, parties[0]);
                if (voteshare0 > party_max[0]) {
                   party_max[0] = voteshare0;
                }
                const voteshare1 = get_voteshare(feature, parties[1]);
                if (voteshare1 > party_max[1]) {
                    party_max[1] = voteshare1;
                }
                if (voteshare0 - voteshare1 > party_diff_max[0]) {
                    party_diff_max[0] = voteshare0 - voteshare1;
                }
                if (voteshare1 - voteshare0 > party_diff_max[1]) {
                   party_diff_max[1] = voteshare1 - voteshare0;
                }
            }
        }

        // build candidate map (fednum -> party -> candidate)
        // (to enable display of candidate on poll mouseover)
        var candidatesMap = {};
        for (fednum in data.polldata) {
            const districtName = (
                data.polldata[fednum].votes.features[0].properties.DistrictName
            );
            candidatesMap[districtName] = {};
            for (party in data.polldata[fednum].candidates) {
                candidatesMap[districtName][party] = (
                    data.polldata[fednum].candidates[party]
                );
            }
        }
      
        // scroll the map into view
        document.getElementById("canadavotes_map").scrollIntoView();

        // clear everything from map
        map.eachLayer((layer) => {
            map.removeLayer(layer);
        });
        map.setView([data.centroid.latitude,
                     data.centroid.longitude],
                    11);

        // little function to display independent candidates party as "Independent"
        function trimParty(party) {
            if (party.startsWith("Independent")) {
                return "Independent";
            } else {
                return party;
            }
        }

        // add custom control
        map.removeControl(info);
        info.onAdd = function (map) {
            this._div = L.DomUtil.create('div', 'info'); // create a div with a class "info"
            this.update();
            return this._div;
        };
        // method that we will use to update the control based on feature properties passed
        function candidatesString(props) {
            var return_string = "";
            for (party in props) {
                if (!(["PD_NUM", "DistrictName", "Poll",
                       "TotalVotes"].includes(party))) {
                    return_string = (
                        return_string
                        + candidatesMap[props.DistrictName][party]
                        + ' (' + trimParty(party) + ')' + ': '
                        + props[party].eday + "<br>"
                    );
                }
           }
           return return_string;
        }
        info.update = function (props) {
            this._div.innerHTML = (
                '<h4>Election ' + year + '</h4>'
                + (props ? ('<h5>' + props.DistrictName + ' poll '
                            + props.Poll + '</h5>'
                            + candidatesString(props))
                   : 'Hover over a poll area!')
            );
        };
        info.addTo(map);

        // background streetmap layer
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 25,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);

        // draw riding boundaries
        function ridingstyle(feature) {
            return {
                fillOpacity: 0,
                weight: 2,
                opacity: 0.8,
                color: 'black'
            };
        }
        var ridingsLayer = L.geoJson(
            data.ridings, {style: ridingstyle}
        ).addTo(map);

        // zoom map to fit ridings layer
        map.fitBounds(ridingsLayer.getBounds());

        // add poll data
        // style functions
        var cscale = (d3.scaleLinear()
                      .domain([-1.0 * party_diff_max[1],
                                 0, party_diff_max[0]])
                      .range([
                          colourmap[parties[1]],
                          "white",
                          colourmap[parties[0]]
                       ]));
        function pollfill(level) {
            return cscale(level);
        }
        function pollstyle(feature) {
            return {
                fillOpacity: 0.6,
                fillColor: pollfill(
                    get_voteshare(feature, parties[0])
                    - get_voteshare(feature, parties[1])
                ),
                weight: 0,
                opacity: 1,
                color: 'gray'
            };
        }
        // add poll data
        var pollLayers = {};
        var pollLayerGroupArray = [];
        for (fednum in data.polldata) {

            function highlightFeature(e) {
                var layer = e.target;
                layer.setStyle({
                    weight: 1.5,
                    color: 'navy',
                    opacity: 0.8,
                    dashArray: '',
                    fillOpacity: 0.6
                });
                layer.bringToFront();
                info.update(layer.feature.properties);
            }
            function resetHighlight(e) {
                pollLayers[fednum].resetStyle(e.target);
                info.update();
            }
            function zoomToFeature(e) {
                map.fitBounds(e.target.getBounds());
            }
            function onEachFeature(feature, layer) {
                 layer.on({
                     mouseover: highlightFeature,
                     mouseout: resetHighlight,
                     click: zoomToFeature
                 });
            }
            pollLayers[fednum] = L.geoJson(
                data.polldata[fednum]["votes"],
                {
                    style: pollstyle,
                    onEachFeature: onEachFeature
                }
            );
            pollLayerGroupArray.push(pollLayers[fednum]);
        }
        var pollLayerGroup = L.layerGroup(pollLayerGroupArray).addTo(map);

        // add tooltips at riding centroids
        /*
        var riding_tooltips = {}
        for (centroid of data.centroids.features) {
         riding_tooltips[centroid.id] = L.tooltip(
            L.latLng(centroid.geometry.coordinates[1],
                     centroid.geometry.coordinates[0]),
            {
               "content": centroid.properties.DistrictName,
               "permanent": false,
               "opacity": 0.6
            }
         ).addTo(map);
        }
        */

        // add legend for colours
        map.removeControl(legend);
        legend.onAdd = function (map) {
            var div = L.DomUtil.create(
                'div', 'info legend'),
                grades = [
                    party_diff_max[0],
                    0.75 * party_diff_max[0],
                    0.50 * party_diff_max[0],
                    0.25 * party_diff_max[0],
                    0,
                    -0.25 * party_diff_max[1],
                    -0.50 * party_diff_max[1],
                    -0.75 * party_diff_max[1],
                    -1.00 * party_diff_max[1]
                ],
                labels = [
                    parties[0] + " +" + (100 * party_diff_max[0]).toFixed(0) + "%",
                    '', '', '',
                    'Equal', '', '', '',
                    parties[1] + " +" + (100 * party_diff_max[1]).toFixed(0) + "%"
                ];

            // loop through our fraction intervals and generate a label with a colored square for each interval
            for (var i = 0; i < grades.length; i++) {
                div.innerHTML +=
                      '<i style="background: ' + cscale(grades[i])
                      + '">&emsp;&emsp;</i> ' +
                      labels[i] + '<BR>';
            }
            return div;
        }
        legend.addTo(map);

        // populate riding data tables
        var tableDiv = document.getElementById("cv_riding_data_table");
        var tableDivString = "";

        var table_data = {};
        for (fednum in data.polldata) {
            table_data[fednum] = [];
            for (party in data.polldata[fednum].candidates) {
                var riding_vote_sums = {
                    "candidate": data.polldata[fednum].candidates[party],
                    "party": party,
                    "eday": 0,
                    "total": 0
                }
                for (feature of data.polldata[fednum].votes.features) {
                    riding_vote_sums.eday += feature.properties[party].eday;
                    riding_vote_sums.total += feature.properties[party].eday;
                }
                riding_vote_sums.special = data.polldata[fednum].special_votes[party];
                riding_vote_sums.advance = data.polldata[fednum].advance_votes[party];
                riding_vote_sums.total += riding_vote_sums.special + riding_vote_sums.advance;
                table_data[fednum].push(riding_vote_sums);
            }
            // sort riding_vote_sums by total votes
            table_data[fednum].sort(
                (obj1, obj2) => obj2["total"] - obj1["total"]
            );

            // add to table
            tableDivString = (tableDivString
                + "<div class='col-8'>"
                + "<h5>"
                + (data.polldata[fednum]
                   .votes
                   .features[0]
                   .properties
                   .DistrictName)
                + "</h5>"
                + "<table class='table table-primary table-striped'>"
                + "<thead>"
                + "<tr><th>Candidate</th>"
                + "<th>Party</th>"
                + "<th>Election Day</th>"
                + "<th>Advance Poll</th>"
                + "<th>Special Votes</th>"
                + "<th>Total</th></tr>"
                + "</thead>"
                + "<tbody>"
            );

            for (tableDatum of table_data[fednum]) {
                tableDivString = (
                    tableDivString
                    + "<tr><td>" + tableDatum.candidate + "</td>"
                    + "<td>" + trimParty(tableDatum.party) + "</td>"
                    + "<td>" + tableDatum.eday + "</td>"
                    + "<td>" + tableDatum.advance + "</td>"
                    + "<td>" + tableDatum.special + "</td>"
                    + "<td>" + tableDatum.total + "</td></tr>"
                );
            }

            tableDivString = (
                tableDivString
                + "</tbody></table>"
                + "<BR><BR></div>"
            );

        }

        tableDiv.innerHTML = tableDivString;

        // unhide table
        tableDiv.style.display = "block";

   }

});
