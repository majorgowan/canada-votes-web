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

    // is this the advance or election-day page?
    const descriptionTag = (document
                            .querySelector("meta[name='description']")
                            .getAttribute("content"));
    var advance = descriptionTag.includes("dvance");
    var ontario = descriptionTag.includes("ntario");

    // instantiate map object and controls
    var map = L.map("canadavotes_map",
                    {fullscreenControl: true});
    var mapElement = document.getElementById("canadavotes_map");
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
        // unhide map and data
        const mapHolder = document.getElementById("cv_map_holder")
        mapHolder.style.display = "block";
        // scroll map and data into view
        mapHolder.scrollIntoView();
        refresh_form(cvForm);
    });

    // when map element is entered, scroll to it!
    mapElement.addEventListener("mouseenter", function(e) {
        mapElement.scrollIntoView();
    });


    function refresh_form(form) {

        var city1 = form.querySelector('input[name="metro-area-radio"]:checked').value;
        var year1 = form.querySelector('input[name="election-year-radio"]:checked').value;
        var party1 = form.querySelector("#cv_party1_selector").value;
        var party2 = form.querySelector("#cv_party2_selector").value;

        // load the data if city or year has changed
        if (city1 != city || year1 != year) {
            city = city1;
            year = year1;
            var filenameBase;
            if (ontario) {
                filenameBase = "leaflet_data_ontario_";
            } else if (advance) {
                filenameBase = "leaflet_data_advance_";
            } else {
                filenameBase = "leaflet_data_eday_";
            }
            Promise.all([
                d3.json(dataurl + filenameBase + city
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
            "Progressive Conservative Party of Ontario": "blue",
            "Liberal": "red",
            "Ontario Liberal Party": "red",
            "NDP-New Democratic Party": "orange",
            "New Democratic Party of Ontario": "orange",
            "Green Party": "green",
            "Green Party of Ontario": "green",
            "Communist": "darkred",
            "People's Party - PPC": "orchid",
            "Bloc Québécois": "lightblue"
        };
        const shortnames = {
            "Progressive Conservative Party of Ontario": "PCO",
            "Ontario Liberal Party": "Liberal",
            "New Democratic Party of Ontario": "NDP",
            "Green Party of Ontario": "Greens"
        }

        function get_voteshare(feature, party) {
            if (party in feature.properties) {
                var voteshare;
                if (advance) {
                    voteshare = (feature.properties[party]["total"]
                                 / feature.properties["TotalVotes"]["total"]);
                } else {
                    voteshare = (feature.properties[party]["eday"]
                                 / feature.properties["TotalVotes"]["eday"]);
                }
                return voteshare;
            } else {
                return 0;
            }
        }

        var oneparty = (parties[0] == parties[1]);

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

        // clear everything from map
        map.eachLayer((layer) => {
            map.removeLayer(layer);
        });

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
                if (!(["PD_NUM", "ADV_POLL_N", "DistrictName", "Poll",
                       "PollNumber", "DistrictNumber",
                       "TotalVotes"].includes(party))) {
                    var partyString;
                    if (advance) {
                        partyString = ("<span class='cv-votecount'>"
                                       + props[party].eday + "</span> (eday), "
                                       + "<span class='cv-votecount'>"
                                       + props[party].advance + "</span> (adv)");
                    } else {
                        partyString = ("<span class='cv-votecount'>"
                                       + props[party].eday + "</span>");
                    }
                    return_string = (
                        return_string
                        + candidatesMap[props.DistrictName][party]
                        + ' (' + trimParty(party) + ')' + ': '
                        + partyString + "<br>"
                    );
                }
           }
           return return_string;
        }
        info.update = function (props) {
            var pollString;
            if (ontario && props) {
                pollString = "<h5>" + props.DistrictName + ' poll ' + props.PollNumber + "</h5>";
            } else if (props) {
                pollString = "<h5>" + props.DistrictName + ' poll' + props.Poll + "</h5>";
            }
            var tabString = "<span class='cv-instruction'><BR>press TAB to cycle through polls</span>";
            this._div.innerHTML = (
                '<h4>Election ' + year + '</h4>'
                + (props ? (pollString + candidatesString(props) + tabString)
                   : 'Hover over a poll division!')
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
                weight: 3,
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
        var cscale;
        if (oneparty) {
            cscale = (d3.scaleLinear()
                        .domain([0, party_max[0]])
                        .range([
                            "white",
                            colourmap[parties[0]]
                         ]));
        } else {
            cscale = (d3.scaleLinear()
                        .domain([-1.0 * party_diff_max[1],
                                 0, party_diff_max[0]])
                        .range([
                            colourmap[parties[1]],
                            "white",
                            colourmap[parties[0]]
                         ]));
        }
        function pollfill(level) {
            return cscale(level);
        }
        function pollstyle(feature) {
            var voteshare;
            if (oneparty) {
                voteshare = get_voteshare(feature, parties[0]);
            } else {
                voteshare = (get_voteshare(feature, parties[0])
                             - get_voteshare(feature, parties[1]));
            }
            return {
                fillOpacity: 0.6,
                fillColor: pollfill(voteshare),
                weight: 0,
                opacity: 1,
                color: 'gray'
            };
        }
        // add poll data
        var pollLayers = {};
        var pollLayerGroupArray = [];
        var mouseInRiding = null;
        function highlightPoll(layer) {
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
        function resetAllPolls() {
            for (fednum in data.polldata) {
                for (layer of pollLayers[fednum].getLayers()) {
                    pollLayers[fednum].resetStyle(layer);
                }
            }
        }

        for (fednum in data.polldata) {
            function highlightFeature(e) {
                var layer = e.target;
                highlightPoll(layer);
                mouseInRiding = layer.ridingNumber;
                selectedPoll[mouseInRiding]["selected"] = layer.myId;
            }
            function resetHighlight(e) {
                // unhighlight all polls
                resetAllPolls();
                mouseInRiding = null;
                info.update();
            }
            function zoomToFeature(e) {
                map.fitBounds(e.target.getBounds());
            }
            // initialize counter to assign indices to polls in each riding
            var pollCounter = 0;
            function onEachFeature(feature, layer) {
                // assign the counter to this poll and incrememnt it
                layer.myId = pollCounter;
                layer.ridingNumber = fednum;
                pollCounter++;
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

        // have Tab cycle through polls in current riding
        window.addEventListener('keydown', function(e) {
            if (e.key === "Tab") {
                // disable usual Tab feature even if not over map
                e.preventDefault();
                if (mouseInRiding in pollLayers) {
                    // shift highlight to next layer in the active riding
                    // keep track of the "selected" poll (not necessarily where mouse is)
                    // and step through with tab until end and then restart at beginning

                    // unhighlight currently selected poll
                    pollLayers[mouseInRiding].resetStyle(selectedLayer);

                    if (selectedPoll[mouseInRiding]["selected"]
                        == selectedPoll[mouseInRiding]["length"] - 1) {
                        selectedPoll[mouseInRiding]["selected"] = 0;
                    } else {
                        selectedPoll[mouseInRiding]["selected"]++;
                    }
                    var selectedLayer = (pollLayers[mouseInRiding]
                                         .getLayers()[selectedPoll[mouseInRiding]["selected"]]);

                    // highlight the new selected layer and update info
                    highlightPoll(selectedLayer);
                    info.update(selectedLayer.feature.properties);
                }
            }
        });


        // add labels at riding centroids
        for (centroid of data.riding_centroids.features) {
            new L.marker(
                [centroid.geometry.coordinates[1],
                 centroid.geometry.coordinates[0]],
                {
                    icon: new L.DivIcon({
                        html: '<span>' + centroid.properties.DistrictName + '</span>',
                        className: "cv-riding-label",
                        iconSize: [120, 50],
                        iconAnchor: [60, 0]
                    }),
                    zIndexOffset: 1000,
                    interactive: false
                }
            ).addTo(map);
        }

        // add legend for colours
        map.removeControl(legend);
        legend.onAdd = function (map) {
            var legendGrades;
            var legendLabels;
            var party0String = parties[0];
            var party1String = parties[1];
            if (parties[0] in shortnames) {
                party0String = shortnames[parties[0]];
            }
            if (parties[1] in shortnames) {
                party1String = shortnames[parties[1]];
            }
            if (oneparty) {
                legendGrades = [
                    1.00 * party_max[0],
                    0.875 * party_max[0],
                    0.75 * party_max[0],
                    0.625 * party_max[0],
                    0.50 * party_max[0],
                    0.375 * party_max[0],
                    0.25 * party_max[0],
                    0.125 * party_max[0],
                    0
                ];
                legendLabels = [
                    "" + (100 * party_max[0]).toFixed(0) + "% " + party0String,
                    '', '', '',
                    "" + (50 * party_max[0]).toFixed(0) + "% ",
                    '', '', '',
                    "0"
                ];
            } else {
                legendGrades = [
                    party_diff_max[0],
                    0.75 * party_diff_max[0],
                    0.50 * party_diff_max[0],
                    0.25 * party_diff_max[0],
                    0,
                    -0.25 * party_diff_max[1],
                    -0.50 * party_diff_max[1],
                    -0.75 * party_diff_max[1],
                    -1.00 * party_diff_max[1]
                ];
                legendLabels = [
                    party0String + " +" + (100 * party_diff_max[0]).toFixed(0) + "%",
                    '', '', '',
                    'Equal', '', '', '',
                    party1String + " +" + (100 * party_diff_max[1]).toFixed(0) + "%"
                ];
            }
            var div = L.DomUtil.create('div', 'info legend');
            // loop through our fraction intervals and generate a label with a colored square for each interval
            for (var i = 0; i < legendGrades.length; i++) {
                div.innerHTML +=
                      '<i style="background: ' + cscale(legendGrades[i])
                      + '">&emsp;&emsp;</i> ' +
                      legendLabels[i] + '<BR>';
            }
            return div;
        }
        legend.addTo(map);

        // populate riding data tables
        var tableDiv = document.getElementById("cv_riding_data_table");
        var tableDivString = "";

        var table_data = {};
        // object to keep track of which poll (index) is selected
        // (used for tabbing through polls)
        var selectedPoll = {};
        for (fednum in data.polldata) {
            table_data[fednum] = [];
            selectedPoll[fednum] = {"length": data.polldata[fednum].votes.features.length}
            for (party in data.polldata[fednum].candidates) {
                var riding_vote_sums = {
                    "candidate": data.polldata[fednum].candidates[party],
                    "party": party,
                    "eday": 0,
                    "advance": 0,
                    "total": 0
                }
                for (feature of data.polldata[fednum].votes.features) {
                    if (advance) {
                        riding_vote_sums.eday += feature.properties[party].eday;
                        riding_vote_sums.advance += feature.properties[party].advance;
                        riding_vote_sums.total += feature.properties[party].total;
                    } else {
                        riding_vote_sums.eday += feature.properties[party].eday;
                        riding_vote_sums.total += feature.properties[party].eday;
                    }
                }
                if (ontario) {
                    riding_vote_sums.advance = data.polldata[fednum].advance_votes[party];
                    riding_vote_sums.total += riding_vote_sums.advance;
                } else {
                    riding_vote_sums.special = data.polldata[fednum].special_votes[party];
                    if (advance) {
                        riding_vote_sums.total += riding_vote_sums.special;
                    } else {
                        // if eday file, just get advance-vote total for riding
                        riding_vote_sums.advance = data.polldata[fednum].advance_votes[party];
                        riding_vote_sums.total += riding_vote_sums.special + riding_vote_sums.advance;
                    }
                }
                table_data[fednum].push(riding_vote_sums);
            }
            // sort riding_vote_sums by total votes
            table_data[fednum].sort(
                (obj1, obj2) => obj2["total"] - obj1["total"]
            );

            // add to table
            tableDivString = (tableDivString
                + "<div class='col-8'>"
                + "<h4 class='cv-riding-name'>"
                + (data.polldata[fednum]
                   .votes
                   .features[0]
                   .properties
                   .DistrictName)
                + "</h4>"
                + "<table class='table table-primary table-striped'>"
                + "<thead>"
                + "<tr><th>Candidate</th>"
                + "<th>Party</th>"
                + "<th>Election Day</th>"
                + "<th>Advance Poll</th>");
            if (!ontario) {
                tableDivString = (tableDivString
                + "<th>Special Votes</th>");
            }
            tableDivString = (tableDivString
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
                    + "<td>" + tableDatum.advance + "</td>");
                if (!ontario) {
                    tableDivString = (tableDivString
                    + "<td>" + tableDatum.special + "</td>");
                }
                tableDivString = (tableDivString
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

        // add listeners to riding titles to focus map on riding on click
        var ridingNames = document.getElementsByClassName("cv-riding-name");
        for (ridingName of ridingNames) {
            const ridingNameText = ridingName.innerHTML;
            ridingName.onclick = function() {
                for (layer of ridingsLayer.getLayers()) {
                    if (layer.feature.properties.DistrictName == ridingNameText) {
                        mapElement.scrollIntoView();
                        map.fitBounds(layer.getBounds());
                    }
                }
            }
        }


   }

});
