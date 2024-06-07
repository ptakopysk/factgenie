// var url_prefix = window.location.href.split(/[?#]/)[0];
var url_prefix = window.url_prefix;
var example_idx = 0;
var total_examples = 1;
var datasets = window.datasets;
var metadata = window.metadata;
// var dataset = null;
var generated_outputs = window.generated_outputs;
var mode = window.mode;
var examples_cached = {};
var sizes = mode == "annotate" ? [50, 50] : [66, 33];
var selected_ann = null;


if (mode == "annotate") {
    var annotation_set = window.annotation_set;
    var annotator_id = window.annotator_id;
    total_examples = annotation_set.length;
}

if (mode == "annotate" || mode == "browse") {
    // the draggable divider between the main area and the right panel
    var splitInstance = Split(['#centerpanel', '#rightpanel'], {
        sizes: sizes, gutterSize: 1
    });
}

if (mode == "crowdsourcing") {
    var model_outs = window.model_outs;
}


function randInt(max) {
    return Math.floor(Math.random() * max);
}

function mod(n, m) {
    return ((n % m) + m) % m;
}

function nextBtn() {
    goToPage(example_idx + 1);
}

function prevBtn() {
    goToPage(example_idx - 1);
}

function startBtn() {
    goToPage(0);
}

function endBtn() {
    goToPage(total_examples - 1);
}

function randomBtn() {
    goToPage(randInt(total_examples - 1));
}

function goToAnnotation(page) {
    $(".page-link").removeClass("bg-active");
    $(`#page-link-${page}`).addClass("bg-active");
    saveCurrentOnly();
    showAnnotation();
}

function goToView(page) {
    const dataset = $('#dataset-select').val();
    const split = $('#split-select').val();

    fetchExample(dataset, split, example_idx);

    $("#page-input").val(example_idx);
}

function goToPage(page) {
    example_idx = page;
    example_idx = mod(example_idx, total_examples);

    if (mode == "annotate") {
        goToAnnotation(example_idx);
    } else {
        goToView(example_idx);
    }
}


function fetchAnnotation(dataset, split, example_idx, annotation_idx) {
    return new Promise((resolve, reject) => {
        // console.log(`fetching ${dataset} ${split} ${example_idx}`);
        $.get(`${url_prefix}/example`, {
            "dataset": dataset,
            "example_idx": example_idx,
            "split": split,
        }, function (data) {
            $('<div>', {
                id: `out-text-${annotation_idx}`,
                class: `annotate-box `,
                style: 'display: none;'
            }).appendTo('#outputarea');

            // filter the data to only include the setup we want
            const setup_id = annotation_set[annotation_idx].setup.id;

            data.generated_outputs = data.generated_outputs.filter(o => o.setup.id == setup_id)[0];

            examples_cached[annotation_idx] = data;

            resolve();
        }).fail(function () {
            reject();
        });
    });
}

function loadAnnotations() {
    $("#dataset-spinner").show();

    const promises = [];
    const error_categories = metadata.error_categories;

    // prefetch the examples for annotation: we need them for YPet initialization
    for (const [annotation_idx, example] of Object.entries(annotation_set)) {
        const dataset = example.dataset;
        const split = example.split;
        const example_idx = example.example_idx;
        const promise = fetchAnnotation(dataset, split, example_idx, annotation_idx);
        promises.push(promise);
    }
    Promise.all(promises)
        .then(() => {
            YPet.addInitializer(function (options) {
                /* Configure the # and colors of Annotation types (minimum 1 required) */
                YPet.AnnotationTypes = new AnnotationTypeList(error_categories);
                var regions = {};
                var paragraphs = {};

                for (const [annotation_idx, data] of Object.entries(examples_cached)) {

                    var p = new Paragraph({ 'text': data.generated_outputs.generated });

                    paragraphs[`p${annotation_idx}`] = p;
                    regions[`p${annotation_idx}`] = `#out-text-${annotation_idx}`;

                    const li = $('<li>', { class: "page-item" });
                    const a = $('<a>', { class: "page-link bg-incomplete", style: "min-height: 28px;", id: `page-link-${annotation_idx}` }).text(annotation_idx);
                    li.append(a);
                    $("#nav-example-cnt").append(li);

                    // switch to the corresponding example when clicking on the page number
                    $(`#page-link-${annotation_idx}`).click(function () {
                        goToPage(annotation_idx);
                    });
                }
                YPet.addRegions(regions);

                for (const [p, p_obj] of Object.entries(paragraphs)) {
                    YPet[p].show(new WordCollectionView({ collection: p_obj.get('words') }));

                    YPet[p].currentView.collection.parentDocument.get('annotations').on('remove', function (model, collection) {
                        if (collection.length == 0) {
                            collection = [];
                        }
                    });
                    goToAnnotation(example_idx);
                }
            });
            YPet.start();

        })
        .catch(() => {
            // Handle errors if any request fails
            console.error("One or more requests failed.");
        })
        .finally(() => {
            // This block will be executed regardless of success or failure
            $("#dataset-spinner").hide();
        });
}

function submitAnnotations(campaign_id) {
    // console.log(annotation_set);
    $.post({
        url: `${url_prefix}/submit_annotations`,
        contentType: 'application/json', // Specify JSON content type
        data: JSON.stringify({
            campaign_id: metadata.id,
            annotator_id: annotator_id,
            annotation_set: annotation_set
        }
        ),
        success: function (data) {
            window.onbeforeunload = null;
            $("#overlay-end").show();
        }
    });
}

function saveCurrentOnly() {
    var collection = YPet[`p${example_idx}`].currentView.collection.parentDocument.get('annotations').toJSON();

    const checkbox_correct = $("#checkbox-correct").is(":checked");
    const checkbox_missing = $("#checkbox-missing").is(":checked");
    const checkbox_off_topic = $("#checkbox-off-topic").is(":checked");

    annotation_set[example_idx]["annotations"] = collection;
    annotation_set[example_idx]["flags"] = {
        "is_fully_correct": checkbox_correct,
        "is_missing": checkbox_missing,
        "is_off_topic": checkbox_off_topic,
    };
}


function markAnnotationAsComplete() {
    var collection = YPet[`p${example_idx}`].currentView.collection.parentDocument.get('annotations').toJSON();

    const checkbox_correct = $("#checkbox-correct").is(":checked");
    const checkbox_missing = $("#checkbox-missing").is(":checked");
    const checkbox_off_topic = $("#checkbox-off-topic").is(":checked");


    // if the collection is empty but the `checkbox-correct` is not checked, display an alert
    if (collection.length == 0 && !(checkbox_correct || checkbox_missing)) {
        alert("Are you *really* sure that the example does not contain any errors? If so, please check the last box to mark the example as complete.");
        return;
    }

    annotation_set[example_idx]["annotations"] = collection;
    annotation_set[example_idx]["flags"] = {
        "is_fully_correct": checkbox_correct,
        "is_missing": checkbox_missing,
        "is_off_topic": checkbox_off_topic,
    };

    $('#page-link-' + example_idx).removeClass("bg-incomplete");
    $('#page-link-' + example_idx).addClass("bg-complete");

    // uncheck all checkboxes
    $("#checkbox-correct").prop("checked", false);
    $("#checkbox-missing").prop("checked", false);
    $("#checkbox-off-topic").prop("checked", false);


    // if all the examples are annotated, post the annotations
    if ($(".bg-incomplete").length == 0) {
        // show the `submit` button
        $("#submit-annotations-btn").show();

        // scroll to the top
        $('html, body').animate({
            scrollTop: $("#submit-annotations-btn").offset().top
        }, 500);

    } else if (example_idx < total_examples - 1) {
        nextBtn();
    }
}

function showRawData(data) {
    var rawDataStr = JSON.stringify(data.raw_data, null, 2).replace(/\\n/g, '<br>');

    if (rawDataStr[0] == '"') {
        // remove the first and last double quotes
        rawDataStr = rawDataStr.slice(1, -1);
    }
    $("#rawarea").html(`<pre>${rawDataStr}</pre>`);
}

function showAnnotation() {
    $(".annotate-box").hide();
    $(`#out-text-${example_idx}`).show();

    const data = examples_cached[example_idx];
    const flags = annotation_set[example_idx].flags;

    if (flags !== undefined) {
        $("#checkbox-correct").prop("checked", flags.is_fully_correct);
        $("#checkbox-missing").prop("checked", flags.is_missing);
        $("#checkbox-off-topic").prop("checked", flags.is_off_topic);
    } else {
        $("#checkbox-correct").prop("checked", false);
        $("#checkbox-missing").prop("checked", false);
        $("#checkbox-off-topic").prop("checked", false);
    }
    $("#examplearea").html(data.html);
    // $(".text-type").html(`${type}`);
}

function permalinkBtn() {
    const dataset = $('#dataset-select').val();
    const split = $('#split-select').val();

    const url_prefix = window.location.href.split(/[?#]/)[0];

    let permalink = `${url_prefix}?dataset=${dataset}&split=${split}&example_idx=${example_idx}`;

    popover = bootstrap.Popover.getOrCreateInstance("#permalink-btn", options = { html: true });
    popover.setContent({
        '.popover-body': permalink
    });
    $('#permalink-btn').popover('show');
}

function goToBtn() {
    var n = $("#page-input").val();
    goToPage(n);
}

function toggleRaw() {
    // toggle display: none on rawarea and examplearea
    $("#rawarea").toggle();
    $("#examplearea").toggle();
}


function changeDataset() {
    $("#dataset-spinner").show();
    const dataset = $('#dataset-select').val();

    // set available splits in #split-select
    $('#split-select').empty();
    for (const split of datasets[dataset].splits) {
        $('#split-select').append(`<option value="${split}">${split}</option>`);
    }
    const split = $('#split-select').val();

    example_idx = 0;
    fetchExample(dataset, split, example_idx);
    $("#page-input").val(example_idx);
}

function changeSplit() {
    $("#dataset-spinner").show();
    const dataset = $('#dataset-select').val();
    const split = $('#split-select').val();
    example_idx = 0;
    fetchExample(dataset, split, example_idx);
    $("#page-input").val(example_idx);
}

function changeExample(dataset, split, example_idx) {
    // used only for direct links
    $("#dataset-spinner").show();
    $('#dataset-select').val(dataset);
    $('#split-select').empty();
    for (const split of datasets[dataset].splits) {
        $('#split-select').append(`<option value="${split}">${split}</option>`);
    }
    $('#split-select').val(split);
    example_idx = example_idx;
    fetchExample(dataset, split, example_idx);
    $("#page-input").val(example_idx);
}

function generateOutputBox(output) {
    const setup_id = output.setup.id;

    var label = $('<label>', { class: "label-name" }).text(setup_id);
    var output_box = $('<div>', {
        id: `out-${setup_id}`,
        class: `output-box generated-output-box box-${setup_id}`,
    }).append(label);

    if (output.generated == null) {
        return output_box;
    }
    const content = output.generated.replace(/\\n/g, '<br>');

    const selectbox = $("#annotations-select");
    selectbox.empty();

    // if no annotations are available, add a placeholder
    if (output.annotations.length == 0) {
        output.annotations.push({ "metadata": { "id": "None" }, "annotations": [] });
    }

    for (const annotations of output.annotations) {
        const metadata = annotations.metadata;
        const campaign_id = metadata.id;
        selectbox.append($("<option>", { value: campaign_id }).text(campaign_id));

        // add default text
        var placeholder = $('<div>', { id: `out-${setup_id}-${campaign_id}-placeholder`, class: `font-mono out-placeholder out-${campaign_id}-placeholder` });

        var annotated_content;

        if (campaign_id == "None") {
            annotated_content = content;
        } else {
            const error_categories = metadata.error_categories;
            annotated_content = annotateContent(content, annotations, error_categories);
        }

        placeholder.html(annotated_content);
        placeholder.hide();
        output_box.append(placeholder);
    }
    return output_box;
}

function annotateContent(content, annotations, error_categories) {
    let offset = 0; // Track cumulative offset
    const annotationSet = annotations.annotations;

    // sort by start
    annotationSet.sort(function (a, b) {
        return a.start - b.start;
    });
    var html = content;

    annotationSet.forEach(annotation => {
        const annotationType = annotation.type;

        if (!(annotationType in error_categories)) {
            console.log("Warning: annotation type not found in error_categories: " + annotationType);
            return;
        }
        const color = error_categories[annotationType].color;
        const text = annotation.text;

        const start = annotation.start + offset;
        const end = start + text.length;

        const error_name = error_categories[annotationType].name;
        const reason = annotation.reason;
        let tooltip_text;

        if (annotation.reason !== undefined) {
            tooltip_text = `${error_name} (${reason})`;
        } else {
            tooltip_text = `${error_name}`;
        }

        const spanId = `span-${start}-${end}`;
        const spanContent = `<span id="${spanId}" style="margin-right: 0px;background-color: ${color};" data-bs-toggle="tooltip" data-bs-placement="top" title="${tooltip_text}">${text}</span>`;

        html = html.slice(0, start) + spanContent + html.slice(end);
        // Update the offset
        offset += spanContent.length - text.length;
    });
    return html;
}

function updateDisplayedAnnotations() {
    const annotator = $("#annotations-select").val();
    // if `selected_ann` contains one of the values in the selectbox, show it
    // otherwise, show the first one
    // const annotator = selected_ann || $("#annotations-select").val();
    // selected_ann = annotator;

    // hide all placeholders
    $(".out-placeholder").hide();

    // show the selected annotator
    $(`.out-${annotator}-placeholder`).show();

    // enableTooltips();
}

function createOutputBoxes(generated_outputs) {
    // clear the output area
    $("#outputarea").empty();

    // sort outputs by setup id
    generated_outputs.sort(function (a, b) {
        return a.setup.id.localeCompare(b.setup.id);
    });

    for (output of generated_outputs) {
        const output_box = generateOutputBox(output);
        output_box.appendTo("#outputarea");
    }
}

function fetchExample(dataset, split, example_idx) {
    // save the current selected annotator
    const selected_ann = $("#annotations-select").val();
    $.get(`${url_prefix}/example`, {
        "dataset": dataset,
        "example_idx": example_idx,
        "split": split,
    }, function (data) {
        $("#examplearea").html(data.html);

        showRawData(data);
        $("#dataset-spinner").hide();

        total_examples = data.total_examples;
        $("#total-examples").html(total_examples - 1);

        createOutputBoxes(data.generated_outputs);

        // if the annotator is still among the values, restore it
        if ($("#annotations-select").find(`option[value='${selected_ann}']`).length > 0) {
            $("#annotations-select").val(selected_ann).trigger("change");
        }


        updateDisplayedAnnotations();
    });
}


$("#dataset-select").on("change", changeDataset);
$("#split-select").on("change", changeSplit);
$("#annotations-select").on("change", updateDisplayedAnnotations);

$(document).keydown(function (event) {
    const key = event.key;

    if (key === "ArrowRight") {
        event.preventDefault();
        nextBtn();
    } else if (key === "ArrowLeft") {
        event.preventDefault();
        prevBtn();
    }
});

$('#page-input').keypress(function (event) {
    // Enter = Go to page
    if (event.keyCode == 13) {
        goToBtn();
    }
});

$("#hideOverlayBtn").click(function () {
    $("#overlay-start").fadeOut();
});

$(".btn-check-data").click(function () {
    updateSelectedDatasets();
});

function updateSelectedDatasets() {
    var selectedData = gatherCampaignData();
    $("#selectedDatasetsContent").html(selectedData.map(d => `${d.dataset} / ${d.split} / ${d.setup_id}`).join("<br>"));
}

function gatherCampaignData() {
    var campaign_datasets = [];
    var campaign_splits = [];
    var campaign_outputs = [];

    // get `data-content` attribute of buttons which have the "checked" property
    $(".btn-check-dataset").each(function () {
        if ($(this).prop("checked")) {
            campaign_datasets.push($(this).attr("data-content"));
        }
    });
    $(".btn-check-split").each(function () {
        if ($(this).prop("checked")) {
            campaign_splits.push($(this).attr("data-content"));
        }
    });
    $(".btn-check-output").each(function () {
        if ($(this).prop("checked")) {
            campaign_outputs.push($(this).attr("data-content"));
        }
    });


    // get all available combinations of datasets, splits, and outputs
    var combinations = [];
    var valid_triplets = model_outs.valid_triplets;

    for (const dataset of campaign_datasets) {
        for (const split of campaign_splits) {
            for (const output of campaign_outputs) {
                if (valid_triplets.some(triplet => triplet.dataset === dataset && triplet.split === split && triplet.setup_id === output)) {
                    combinations.push({ dataset: dataset, split: split, setup_id: output });
                }
            }
        }
    }
    return combinations;

}


function createLLMEval() {
    const campaignId = $('#campaignId').val();
    const sortOrder = $('#sortOrder').val();
    const llmConfig = $('#llmConfig').val();
    var campaignData = gatherCampaignData();

    $.post({
        url: `${url_prefix}/llm_eval/new`,
        contentType: 'application/json', // Specify JSON content type
        data: JSON.stringify({
            campaignId: campaignId,
            campaignData: campaignData,
            llmConfig: llmConfig,
            sortOrder: sortOrder,
        }),
        success: function (response) {
            console.log(response);

            if (response.success !== true) {
                alert(response.error);
            } else {
                // hide modal
                $('#new-eval-modal').modal('hide');
                // refresh list of campaigns
                location.reload();
            }
        }
    });
}

function startCampaign() {
    const campaignId = $('#campaignId').val();
    const examplesPerBatch = $('#examplesPerBatch').val();
    const idleTime = $('#idleTime').val();
    const prolificCode = $('#prolificCode').val() || ""; // Optional field
    const sortOrder = $('#sortOrder').val();

    var campaignData = gatherCampaignData();

    const errorCategories = [];
    $("#error-categories").children().each(function () {
        const name = $(this).find("#errorCategoryName").val();
        const color = $(this).find("#errorCategoryColor").val();
        errorCategories.push({ name: name, color: color });
    }
    );

    $.post({
        url: `${url_prefix}/crowdsourcing/new`,
        contentType: 'application/json', // Specify JSON content type
        data: JSON.stringify({
            campaignId: campaignId,
            examplesPerBatch: examplesPerBatch,
            idleTime: idleTime,
            prolificCode: prolificCode,
            campaignData: campaignData,
            sortOrder: sortOrder,
            errorCategories: errorCategories,
        }),
        success: function (response) {
            console.log(response);

            if (response.success !== true) {
                alert(response.error);
            } else {
                // hide modal
                $('#new-campaign-modal').modal('hide');
                // refresh list of campaigns
                location.reload();
            }
        }
    });
}

function runLlmEval(campaignId) {
    $.post({
        url: `${url_prefix}/llm_eval/run`,
        contentType: 'application/json', // Specify JSON content type
        data: JSON.stringify({
            campaignId: campaignId
        }),
        success: function (response) {
            console.log(response);
        }
    });
}

function stopLlmEval(campaignId) {
    $.post({
        url: `${url_prefix}/llm_eval/stop`,
        contentType: 'application/json', // Specify JSON content type
        data: JSON.stringify({
            campaignId: campaignId
        }),
        success: function (response) {
            console.log(response);
        }
    });
}

function deleteCampaign(campaignId, source) {
    // ask for confirmation
    if (!confirm(`Are you sure you want to delete the campaign ${campaignId}? All the data will be lost!`)) {
        return;
    }

    $.post({
        url: `${url_prefix}/delete_campaign`,
        contentType: 'application/json', // Specify JSON content type
        data: JSON.stringify({
            campaignId: campaignId,
            source: source
        }),
        success: function (response) {
            console.log(response);

            if (response.success !== true) {
                alert(response.error);
            } else {
                // remove the campaign from the list
                $(`#campaign-${campaignId}`).remove();

                // reload the page
                location.reload();
            }
        }
    });
}

function addErrorCategory() {
    const errorCategories = $("#error-categories");
    const newCategory = $(`
    <div class="d-flex justify-content-between align-items-center mt-1">
      <input type="text" class="form-control" id="errorCategoryName" name="errorCategoryName">
      <input type="color" class="form-control" id="errorCategoryColor" name="errorCategoryColor">
      <button type="button" class="btn btn-danger" onclick="deleteErrorCategory(this)">Delete</button>
    </div>
    `);
    errorCategories.append(newCategory);
}

function deleteErrorCategory(button) {
    $(button).parent().remove();
}


function enableTooltips() {
    // enable tooltips
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
    var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl)
    })
}

$(document).ready(function () {
    if (mode == "annotate") {
        loadAnnotations();

        $("#total-examples").html(total_examples - 1);
    } else if (mode == "browse") {
        if (window.display_example != null) {
            const e = window.display_example;
            changeExample(e.dataset, e.split, e.example_idx);
        }
        else {
            // select the first dataset from the selectbox
            $("#dataset-select").val(Object.keys(datasets)[0]).trigger("change");
            $("#page-input").val(example_idx);
        }
    }

    enableTooltips();
});

if (mode == "annotate") {
    window.onbeforeunload = function () {
        return "Are you sure you want to reload the page? Your work will be lost.";
    }
}